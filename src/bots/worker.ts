import type { PrismaClient } from "@prisma/client";
import { firstMatchingRule, shouldEscalate } from "./engine.js";
import type { JobQueue } from "../jobs/queue.js";

export async function evaluateBotMessage(prisma: PrismaClient, inboundMessageId: string, outboundQueue: JobQueue) {
  const message = await prisma.message.findUnique({ where: { id: inboundMessageId }, include: { conversation: true } });
  if (!message || message.direction !== "INBOUND" || !message.body) return;
  if (message.conversation.status !== "OPEN" || message.conversation.assignedUserId) return;
  const rules = await prisma.botRule.findMany({ where: { businessId: message.conversation.businessId, enabled: true }, orderBy: [{ priority: "asc" }, { id: "asc" }] });
  const matched = firstMatchingRule(rules, message.body);
  const rule = matched ? rules.find((candidate) => candidate.id === matched.id) : undefined;
  const attemptNumber = await prisma.botAttempt.count({ where: { conversationId: message.conversationId } }) + 1;
  const escalation = shouldEscalate({ body: message.body, attemptNumber, maxAttempts: rule?.escalateAfterAttempts ?? undefined });
  if (escalation || !rule) {
    await prisma.$transaction([
      prisma.botAttempt.create({ data: { conversationId: message.conversationId, inboundMessageId: message.id, botRuleId: rule?.id, attemptNumber, outcome: "ESCALATED", escalationReason: escalation ?? "no_matching_rule" } }),
      prisma.conversation.update({ where: { id: message.conversationId }, data: { status: "OPEN", assignedUserId: null, botHandled: false } }),
    ]);
    return;
  }
  const attempt = await prisma.botAttempt.upsert({
    where: { inboundMessageId_botRuleId: { inboundMessageId: message.id, botRuleId: rule.id } },
    update: {},
    create: { conversationId: message.conversationId, inboundMessageId: message.id, botRuleId: rule.id, attemptNumber, outcome: "MATCHED" },
  });
  if (attempt.outcome === "RESPONDED") return;
  if (rule.responseType !== "TEXT" || !rule.response) return;
  const outbound = await prisma.message.upsert({
    where: { clientMsgId: `bot:${message.id}:${rule.id}` },
    update: {},
    create: { conversationId: message.conversationId, clientMsgId: `bot:${message.id}:${rule.id}`, direction: "OUTBOUND", authorType: "BOT", type: "TEXT", body: rule.response, rawPayload: {}, status: "QUEUED" },
  });
  await prisma.botAttempt.update({ where: { id: attempt.id }, data: { outcome: "RESPONDED", completedAt: new Date() } });
  await outboundQueue.add("send", { messageId: outbound.id }, { jobId: `send-${outbound.id}` });
}
