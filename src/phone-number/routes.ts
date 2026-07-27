import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { MetaClient } from "../adapters/meta.js";
import { authorize } from "../auth/authorization.js";
import { validCsrf } from "../auth/csrf.js";

const paramsSchema = z.object({ id: z.string().cuid() });
const startSchema = z.object({
  displayPhone: z.string().trim().min(8).max(24),
  displayName: z.string().trim().min(2).max(120),
});
const verifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export function registerPhoneNumberRoutes(app: FastifyInstance, prisma: PrismaClient, meta: MetaClient) {
  app.post("/v1/businesses/:id/phone-number/start", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = startSchema.safeParse(request.body);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, params.data.id, "config.edit");
    if (auth.status !== 200) return reply.code(auth.status).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });

    const setup = await meta.startMockSetup(body.data);
    return prisma.phoneNumber.upsert({
      where: { businessId: params.data.id },
      update: { ...setup, status: "PENDING_VERIFICATION", lastError: null },
      create: { businessId: params.data.id, ...setup },
      select: { phoneNumberId: true, displayPhone: true, displayName: true, status: true },
    });
  });

  app.post("/v1/businesses/:id/phone-number/verify", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = verifySchema.safeParse(request.body);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, params.data.id, "config.edit");
    if (auth.status !== 200) return reply.code(auth.status).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    const phone = await prisma.phoneNumber.findUnique({ where: { businessId: params.data.id } });
    if (!phone) return reply.code(404).send({ error: "not_found" });

    await prisma.phoneNumber.update({ where: { id: phone.id }, data: { status: "VERIFYING" } });
    try {
      await meta.verifyPhone({ phoneNumberId: phone.phoneNumberId, code: body.data.code, ...(phone.userAccessToken ? { accessToken: phone.userAccessToken } : {}) });
      return await prisma.phoneNumber.update({
        where: { id: phone.id }, data: { status: "ACTIVE", verifiedAt: new Date(), lastError: null },
        select: { phoneNumberId: true, displayPhone: true, displayName: true, status: true, verifiedAt: true },
      });
    } catch (error) {
      await prisma.phoneNumber.update({ where: { id: phone.id }, data: { status: "FAILED", lastError: error instanceof Error ? error.message : "verification_failed" } });
      return reply.code(422).send({ error: "verification_failed" });
    }
  });

  app.get("/v1/businesses/:id/phone-number", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, params.data.id, "config.view");
    if (auth.status !== 200) return reply.code(auth.status).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    return prisma.phoneNumber.findUnique({ where: { businessId: params.data.id }, select: { phoneNumberId: true, displayPhone: true, displayName: true, status: true, displayNameStatus: true, qualityRating: true, verifiedAt: true, userAccessTokenExpiresAt: true, wabaId: true } });
  });

  app.delete("/v1/businesses/:id/phone-number", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, params.data.id, "config.edit");
    if (auth.status !== 200) return reply.code(auth.status).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    const phone = await prisma.phoneNumber.findUnique({ where: { businessId: params.data.id } });
    if (!phone) return reply.code(204).send();

    try {
      await meta.disconnectPhone({ phoneNumberId: phone.phoneNumberId });
    } catch (error) {
      request.log.warn({ err: error, phoneNumberId: phone.phoneNumberId }, "meta deregister failed; continuing with local cleanup");
    }

    await prisma.$transaction([
      prisma.phoneNumber.delete({ where: { id: phone.id } }),
      prisma.auditEvent.create({
        data: {
          businessId: params.data.id,
          userId: auth.user.id,
          type: "phone.disconnected",
          payload: { phoneNumberId: phone.phoneNumberId, displayPhone: phone.displayPhone, displayName: phone.displayName },
        },
      }),
    ]);
    return reply.code(204).send();
  });
}
