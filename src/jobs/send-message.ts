import type { PrismaClient } from "@prisma/client";
import type { MetaClient } from "../adapters/meta.js";
import type { EventPublisher } from "../realtime/publisher.js";

export async function sendOutboundMessage(
  prisma: PrismaClient,
  meta: MetaClient,
  publisher: EventPublisher,
  messageId: string,
) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      conversation: {
        include: {
          contact: true,
          business: { include: { phoneNumber: true } },
        },
      },
    },
  });
  if (!message || message.waMessageId || !["QUEUED", "FAILED"].includes(message.status)) return;
  const phone = message.conversation.business.phoneNumber;
  if (!phone || phone.status !== "ACTIVE") throw new Error("Business phone is not active");

  await prisma.message.update({ where: { id: message.id }, data: { status: "SENDING", transportError: undefined } });
  try {
    const result = await meta.sendMessage({
      phoneNumberId: phone.phoneNumberId,
      to: message.conversation.contact.waId,
      type: message.type as "TEXT" | "IMAGE" | "DOCUMENT",
      body: message.body ?? undefined,
      mediaId: message.providerMediaId ?? undefined,
    });
    await prisma.$transaction([
      prisma.message.update({ where: { id: message.id }, data: { waMessageId: result.waMessageId, status: "SENT" } }),
      prisma.conversation.update({
        where: { id: message.conversationId },
        data: {
          lastMessageAt: message.timestamp,
          ...(message.authorType === "AGENT" ? { firstResponseAt: message.conversation.firstResponseAt ?? new Date() } : {}),
        },
      }),
    ]);
    await publisher.publish(message.conversation.businessId, { type: "message.updated", id: message.id });
  } catch (error) {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: "FAILED", transportError: { message: error instanceof Error ? error.message.slice(0, 500) : "send_failed" } },
    });
    throw error;
  }
}

const statusRank = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 } as const;

export async function applyMessageStatus(prisma: PrismaClient, waMessageId: string, status: "SENT" | "DELIVERED" | "READ" | "FAILED", raw: object) {
  const message = await prisma.message.findUnique({ where: { waMessageId } });
  if (!message || statusRank[status] <= statusRank[message.status]) return message;
  return prisma.message.update({ where: { id: message.id }, data: { status, transportError: status === "FAILED" ? raw : undefined } });
}
