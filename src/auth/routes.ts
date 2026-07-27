import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "./authorization.js";
import type { EmailSender } from "./email.js";
import { hashPassword, passwordPolicy, verifyPassword } from "./password.js";

// ponytail: per-IP and per-email rate limit skipped, add when credentials
// are exposed to the public internet or a load test shows brute-force traffic.

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const passwordBody = z.string().refine(passwordPolicy, "Password must be 8 to 128 characters");
const registerBody = z.object({
  email: z.email(),
  password: passwordBody,
  name: z.string().trim().min(1).max(120).optional(),
});
const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
const emailBody = z.object({ email: z.email() });
const resetBody = z.object({ token: z.string().min(1).max(256), password: passwordBody });

export type AuthRouteOptions = {
  secureCookies: boolean;
  emailSender: EmailSender;
  appUrl: string;
};

export function registerAuthRoutes(app: FastifyInstance, prisma: PrismaClient, options: AuthRouteOptions) {
  const { secureCookies, emailSender, appUrl } = options;
  const resetUrl = (token: string) => `${appUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;

  app.post("/v1/auth/register", async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const email = parsed.data.email.trim().toLowerCase();
    const passwordHash = await hashPassword(parsed.data.password);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing?.passwordHash) return reply.code(409).send({ error: "email_in_use" });
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, passwordUpdatedAt: new Date() } })
      : await prisma.user.create({ data: { email, passwordHash, passwordUpdatedAt: new Date(), ...(parsed.data.name ? { name: parsed.data.name } : {}) } });
    return reply.code(201).send({ user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const sessionToken = createToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sessionToken.hash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      },
    });
    const csrf = createToken().token;
    reply.setCookie("session", sessionToken.token, {
      httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/", maxAge: 30 * 24 * 60 * 60,
    });
    reply.setCookie("csrf", csrf, {
      httpOnly: false, sameSite: "lax", secure: secureCookies, path: "/", maxAge: 30 * 24 * 60 * 60,
    });
    return { user: { id: user.id, email: user.email, name: user.name }, csrfToken: csrf };
  });

  app.get("/v1/auth/session", async (request, reply) => {
    const user = await authenticate(request, prisma);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { user: { id: user.id, email: user.email, name: user.name, isStaff: user.isStaff } };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = request.cookies.session;
    if (token) await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() },
    });
    reply.clearCookie("session", { path: "/" }).clearCookie("csrf", { path: "/" });
    return reply.code(204).send();
  });

  app.post("/v1/auth/forgot-password", async (request, reply) => {
    const parsed = emailBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = createToken();
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: token.hash,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      });
      try {
        await emailSender.sendPasswordReset(email, resetUrl(token.token));
      } catch (error) {
        request.log.error({ err: error, email }, "password reset email failed");
      }
    }
    return reply.code(204).send();
  });

  app.post("/v1/auth/reset-password", async (request, reply) => {
    const parsed = resetBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { token, password } = parsed.data;
    const tokenHash = hashToken(token);
    const reset = await prisma.passwordReset.findUnique({ where: { tokenHash } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return reply.code(400).send({ error: "invalid_token" });
    }
    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash, passwordUpdatedAt: new Date() } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return reply.code(204).send();
  });
}

function createToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
