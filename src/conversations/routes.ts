import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../auth/authorization.js";
import { validCsrf } from "../auth/csrf.js";
import type { EventPublisher } from "../realtime/publisher.js";

const businessParams = z.object({ id: z.string().cuid() });
const conversationParams = z.object({ id: z.string().cuid() });
const listQuery = z.object({ status: z.enum(["OPEN", "ASSIGNED", "RESOLVED"]).optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
const messagesQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const assignBody = z.object({ userId: z.string().cuid().nullable().optional() });
const readBody = z.object({ messageId: z.string().cuid() });

type Cursor = { at: string; id: string };
function decodeCursor(value?: string): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    return typeof parsed.at === "string" && typeof parsed.id === "string" ? parsed : null;
  } catch { return null; }
}
function encodeCursor(at: Date, id: string) {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString("base64url");
}

export function registerConversationRoutes(app: FastifyInstance, prisma: PrismaClient, publisher: EventPublisher) {
  app.get("/v1/businesses/:id/conversations", async (request, reply) => {
    const params = businessParams.safeParse(request.params);
    const query = listQuery.safeParse(request.query);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });
    const auth = await authorize(request, prisma, params.data.id, "chats.view");
    if (auth.status !== 200) return reply.code(auth.status).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    const cursor = decodeCursor(query.data.cursor);
    if (query.data.cursor && !cursor) return reply.code(400).send({ error: "invalid_cursor" });
    const items = await prisma.conversation.findMany({
      where: {
        businessId: params.data.id,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(cursor ? { OR: [{ lastMessageAt: { lt: new Date(cursor.at) } }, { lastMessageAt: new Date(cursor.at), id: { lt: cursor.id } }] } : {}),
      },
      include: {
        contact: { select: { id: true, name: true, waId: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
        messages: { take: 1, orderBy: [{ timestamp: "desc" }, { id: "desc" }], select: { body: true, type: true, timestamp: true } },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: query.data.limit + 1,
    });
    const hasMore = items.length > query.data.limit;
    const page = items.slice(0, query.data.limit);
    const last = page.at(-1);
    return { items: page, nextCursor: hasMore && last ? encodeCursor(last.lastMessageAt, last.id) : null };
  });

  app.get("/v1/conversations/:id/messages", async (request, reply) => {
    const params = conversationParams.safeParse(request.params);
    const query = messagesQuery.safeParse(request.query);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });
    const conversation = await prisma.conversation.findUnique({ where: { id: params.data.id } });
    if (!conversation) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, conversation.businessId, "chats.view");
    if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : 404).send({ error: auth.status === 401 ? "unauthorized" : "not_found" });
    const cursor = decodeCursor(query.data.cursor);
    if (query.data.cursor && !cursor) return reply.code(400).send({ error: "invalid_cursor" });
    const items = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(cursor ? { OR: [{ timestamp: { lt: new Date(cursor.at) } }, { timestamp: new Date(cursor.at), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: query.data.limit + 1,
    });
    const hasMore = items.length > query.data.limit;
    const page = items.slice(0, query.data.limit);
    const last = page.at(-1);
    return { items: page.reverse(), nextCursor: hasMore && last ? encodeCursor(last.timestamp, last.id) : null };
  });

  app.post("/v1/conversations/:id/assign", async (request, reply) => {
    const params = conversationParams.safeParse(request.params);
    const body = assignBody.safeParse(request.body ?? {});
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const conversation = await prisma.conversation.findUnique({ where: { id: params.data.id } });
    if (!conversation) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, conversation.businessId, "chats.assign");
    if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    const targetUserId = body.data.userId === undefined ? auth.user.id : body.data.userId;
    if (targetUserId) {
      const target = await prisma.businessMember.findUnique({ where: { userId_businessId: { userId: targetUserId, businessId: conversation.businessId } } });
      if (!target) return reply.code(404).send({ error: "not_found" });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.conversation.updateMany({
        where: { id: conversation.id, updatedAt: conversation.updatedAt },
        data: { assignedUserId: targetUserId, status: targetUserId ? "ASSIGNED" : "OPEN", assignedAt: targetUserId ? new Date() : null },
      });
      if (claimed.count !== 1) return null;
      await tx.conversationAssignment.create({ data: { conversationId: conversation.id, fromUserId: conversation.assignedUserId, toUserId: targetUserId, actorUserId: auth.user.id, reason: targetUserId ? "assigned" : "returned_to_pool" } });
      return tx.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    });
    if (!updated) return reply.code(409).send({ error: "assignment_conflict" });
    await publisher.publish(conversation.businessId, { type: "conversation.updated", id: conversation.id });
    return updated;
  });

  app.post("/v1/conversations/:id/resolve", async (request, reply) => {
    const params = conversationParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const conversation = await prisma.conversation.findUnique({ where: { id: params.data.id } });
    if (!conversation) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, conversation.businessId, "chats.assign");
    if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : 404).send({ error: auth.status === 401 ? "unauthorized" : "not_found" });
    const updated = await prisma.conversation.update({ where: { id: conversation.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolver: "AGENT" } });
    await publisher.publish(conversation.businessId, { type: "conversation.updated", id: conversation.id });
    return updated;
  });

  app.post("/v1/conversations/:id/read", async (request, reply) => {
    const params = conversationParams.safeParse(request.params);
    const body = readBody.safeParse(request.body);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const user = await authenticate(request, prisma);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const message = await prisma.message.findFirst({ where: { id: body.data.messageId, conversationId: params.data.id }, include: { conversation: true } });
    if (!message) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, message.conversation.businessId, "chats.view");
    if (auth.status !== 200) return reply.code(404).send({ error: "not_found" });
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: params.data.id, userId: user.id } },
      update: { lastReadMessageId: message.id, readAt: new Date() },
      create: { conversationId: params.data.id, userId: user.id, lastReadMessageId: message.id },
    });
    return reply.code(204).send();
  });
}
