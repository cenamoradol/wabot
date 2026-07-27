import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorize } from "../auth/authorization.js";
import { validCsrf } from "../auth/csrf.js";
import type { JobQueue } from "../jobs/queue.js";
import type { createObjectStorage } from "../infra/object-storage.js";

const paramsSchema = z.object({ id: z.string().cuid() });
const uploadSchema = z.object({ contentType: z.string().min(1).max(120), contentLength: z.coerce.number().int().min(1).max(16 * 1024 * 1024) });
const sendSchema = z.object({
  clientMsgId: z.uuid(),
  type: z.enum(["TEXT", "IMAGE", "DOCUMENT"]),
  body: z.string().trim().max(4096).optional(),
  mediaLocalKey: z.string().max(512).optional(),
}).refine((data) => data.type === "TEXT" ? Boolean(data.body) : Boolean(data.mediaLocalKey), "Message content is required");

export function registerMessageRoutes(app: FastifyInstance, prisma: PrismaClient, queue: JobQueue, storage?: ReturnType<typeof createObjectStorage>) {
  app.post("/v1/businesses/:id/uploads", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = uploadSchema.safeParse(request.body);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!storage) return reply.code(503).send({ error: "storage_unavailable" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, params.data.id, "chats.respond");
    if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    const key = `${params.data.id}/uploads/${randomUUID()}`;
    return { key, url: await storage.presignPut(key, body.data.contentType, body.data.contentLength), expiresIn: 900 };
  });

  app.post("/v1/conversations/:id/messages", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = sendSchema.safeParse(request.body);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const conversation = await prisma.conversation.findUnique({ where: { id: params.data.id } });
    if (!conversation) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, conversation.businessId, "chats.respond");
    if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : 404).send({ error: auth.status === 401 ? "unauthorized" : "not_found" });
    if (body.data.mediaLocalKey && !body.data.mediaLocalKey.startsWith(`${conversation.businessId}/uploads/`)) return reply.code(404).send({ error: "not_found" });

    const existing = await prisma.message.findUnique({ where: { clientMsgId: body.data.clientMsgId } });
    if (existing) {
      if (existing.conversationId !== conversation.id) return reply.code(409).send({ error: "idempotency_conflict" });
      return existing;
    }
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        clientMsgId: body.data.clientMsgId,
        direction: "OUTBOUND",
        authorType: "AGENT",
        authorUserId: auth.user.id,
        type: body.data.type,
        body: body.data.body,
        mediaLocalKey: body.data.mediaLocalKey,
        rawPayload: {},
      },
    });
    try {
      await queue.add("send", { messageId: message.id }, { jobId: `send-${message.id}`, attempts: 5, backoff: { type: "exponential", delay: 2_000 } });
    } catch (error) {
      request.log.error({ err: error, messageId: message.id }, "message saved but enqueue failed");
    }
    return reply.code(202).send(message);
  });
}
