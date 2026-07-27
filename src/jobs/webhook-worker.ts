import type { PrismaClient } from "@prisma/client";
import { applyMessageStatus } from "./send-message.js";
import type { JobQueue } from "./queue.js";
import { z } from "zod";

const incomingSchema = z.object({
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(z.object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    image: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
    document: z.object({ id: z.string(), mime_type: z.string().optional(), filename: z.string().optional() }).optional(),
    audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  })).optional(),
  statuses: z.array(z.object({
    id: z.string(),
    status: z.enum(["sent", "delivered", "read", "failed"]),
  }).passthrough()).optional(),
}).passthrough();

function messageType(type: string) {
  if (type === "text" || type === "image" || type === "document" || type === "audio") return type.toUpperCase() as "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO";
  return "UNSUPPORTED" as const;
}

export async function processWebhookEvent(prisma: PrismaClient, webhookEventId: string, mediaQueue?: JobQueue, botQueue?: JobQueue) {
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const claimed = await prisma.webhookEvent.updateMany({
    where: {
      id: webhookEventId,
      processedAt: null,
      OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }],
    },
    data: { processingStartedAt: new Date(), attemptCount: { increment: 1 }, lastError: null },
  });
  if (claimed.count !== 1) return;

  try {
    const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: webhookEventId } });
    const parsed = incomingSchema.parse(event.payload);
    for (const incoming of parsed.messages ?? []) {
      const providerMediaId = incoming.image?.id ?? incoming.document?.id ?? incoming.audio?.id;
      const message = await prisma.$transaction(async (tx) => {
        const profile = parsed.contacts?.find((contact) => contact.wa_id === incoming.from)?.profile;
        const contact = await tx.contact.upsert({
          where: { businessId_waId: { businessId: event.businessId, waId: incoming.from } },
          update: { ...(profile?.name ? { name: profile.name } : {}) },
          create: { businessId: event.businessId, waId: incoming.from, name: profile?.name },
        });
        let conversation = await tx.conversation.findFirst({
          where: { businessId: event.businessId, contactId: contact.id, status: { not: "RESOLVED" } },
          orderBy: { lastMessageAt: "desc" },
        });
        conversation ??= await tx.conversation.create({ data: { businessId: event.businessId, contactId: contact.id } });
        const timestamp = new Date(Number(incoming.timestamp) * 1000);
        const savedMessage = await tx.message.upsert({
          where: { waMessageId: incoming.id },
          update: {},
          create: {
            conversationId: conversation.id,
            waMessageId: incoming.id,
            direction: "INBOUND",
            authorType: "CONTACT",
            type: messageType(incoming.type),
            body: incoming.text?.body,
            mediaMimeType: incoming.image?.mime_type ?? incoming.document?.mime_type ?? incoming.audio?.mime_type,
            providerMediaId,
            mediaFileName: incoming.document?.filename,
            status: "DELIVERED",
            timestamp,
            providerTimestamp: timestamp,
            rawPayload: incoming,
          },
        });
        await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: timestamp } });
        return savedMessage;
      });
      if (providerMediaId && mediaQueue) {
        await mediaQueue.add("download", { messageId: message.id }, { jobId: `media-${message.id}` });
      }
      if (botQueue) {
        await botQueue.add("evaluate", { messageId: message.id }, { jobId: `bot-${message.id}` });
      }
    }
    for (const status of parsed.statuses ?? []) {
      await applyMessageStatus(prisma, status.id, status.status.toUpperCase() as "SENT" | "DELIVERED" | "READ" | "FAILED", status);
    }
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), processingStartedAt: null } });
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processingStartedAt: null,
        lastError: error instanceof Error ? error.message.slice(0, 1000) : "processing_failed",
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });
    throw error;
  }
}

export async function recoverWebhookEvents(prisma: PrismaClient, queue: JobQueue) {
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const events = await prisma.webhookEvent.findMany({
    where: {
      processedAt: null,
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
        { OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }] },
      ],
    },
    select: { id: true },
    take: 500,
    orderBy: { receivedAt: "asc" },
  });
  await Promise.all(events.map((event) => queue.add("process", { webhookEventId: event.id }, { jobId: `webhook-${event.id}` })));
  return events.length;
}
