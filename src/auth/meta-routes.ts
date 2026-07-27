import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { authenticate } from "./authorization.js";
import { validCsrf } from "./csrf.js";
import type { MetaClient } from "../adapters/meta.js";

const callbackBody = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(1024),
  businessId: z.string().cuid(),
});

type StatePayload = {
  businessId: string;
  userId: string;
  nonce: string;
  exp: number;
};

function signState(payload: StatePayload, secret: string): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(token: string, secret: string): StatePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const body: string = parts[0] ?? "";
  const sig: string = parts[1] ?? "";
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const provided = Buffer.from(sig, "base64url");
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  let payload: StatePayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload; } catch { return null; }
  if (typeof payload.businessId !== "string" || typeof payload.userId !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export type MetaAuthRouteOptions = {
  prisma: PrismaClient;
  meta: MetaClient;
  appId: string;
  appSecret: string;
  configId: string;
  redirectUri: string;
  webhookUrl: string;
  webhookVerifyToken: string;
};

export function registerMetaAuthRoutes(app: FastifyInstance, options: MetaAuthRouteOptions) {
  const { prisma, meta, appId, appSecret, configId, redirectUri, webhookUrl, webhookVerifyToken } = options;
  const enabled = Boolean(configId) && Boolean(appId) && Boolean(redirectUri);

  app.post("/v1/businesses/:id/phone-number/embedded-start", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "not_found" });
    const params = z.object({ id: z.string().cuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const user = await authenticate(request, prisma);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const state = signState(
      { businessId: params.data.id, userId: user.id, nonce: randomBytes(8).toString("base64url"), exp: Math.floor(Date.now() / 1000) + 10 * 60 },
      appSecret,
    );
    return { method: "facebook" as const, configId, redirectUri, state };
  });

  app.post("/v1/auth/meta/callback", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "not_found" });
    const parsed = callbackBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const user = await authenticate(request, prisma);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const state = verifyState(parsed.data.state, appSecret);
    if (!state || state.businessId !== parsed.data.businessId || state.userId !== user.id) {
      return reply.code(400).send({ error: "invalid_state" });
    }

    const business = await prisma.business.findUnique({ where: { id: parsed.data.businessId } });
    if (!business) return reply.code(404).send({ error: "not_found" });

    let exchanged;
    try {
      exchanged = await meta.exchangeCode({
        code: parsed.data.code,
        redirectUri,
        appId,
        appSecret,
      });
    } catch (error) {
      request.log.error({ err: error }, "meta exchangeCode failed");
      return reply.code(502).send({ error: "meta_exchange_failed" });
    }

    try {
      await meta.subscribeWebhook({
        wabaId: exchanged.wabaId,
        accessToken: exchanged.accessToken,
        callbackUrl: webhookUrl,
        verifyToken: webhookVerifyToken,
      });
    } catch (error) {
      request.log.warn({ err: error, wabaId: exchanged.wabaId }, "subscribe webhook failed; continuing");
    }

    const phone = await prisma.phoneNumber.upsert({
      where: { businessId: business.id },
      update: {
        phoneNumberId: exchanged.phoneNumberId,
        displayPhone: exchanged.displayPhone,
        displayName: exchanged.displayName,
        status: "PENDING_VERIFICATION",
        wabaId: exchanged.wabaId,
        userAccessToken: exchanged.accessToken,
        userAccessTokenExpiresAt: exchanged.expiresAt,
        lastError: null,
      },
      create: {
        businessId: business.id,
        phoneNumberId: exchanged.phoneNumberId,
        displayPhone: exchanged.displayPhone,
        displayName: exchanged.displayName,
        status: "PENDING_VERIFICATION",
        wabaId: exchanged.wabaId,
        userAccessToken: exchanged.accessToken,
        userAccessTokenExpiresAt: exchanged.expiresAt,
      },
      select: { phoneNumberId: true, displayPhone: true, displayName: true, status: true },
    });
    return phone;
  });
}

export const __test = { signState, verifyState };
