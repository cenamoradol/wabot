import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorize } from "../auth/authorization.js";

const params = z.object({ id: z.string().cuid() });
const range = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

export function registerMetricRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/v1/businesses/:id/metrics/summary", async (request, reply) => {
    const parsed = params.safeParse(request.params); const query = range.safeParse(request.query);
    if (!parsed.success || !query.success) return reply.code(400).send({ error: "invalid_request" });
    const auth = await authorize(request, prisma, parsed.data.id, "metrics.view"); if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    const to = query.data.to ?? new Date(); const from = query.data.from ?? new Date(to.getTime() - 30 * 86_400_000);
    if (to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) return reply.code(400).send({ error: "invalid_range" });
    const [open, unassigned, oldAssigned, resolved] = await Promise.all([
      prisma.conversation.count({ where: { businessId: parsed.data.id, status: { in: ["OPEN", "ASSIGNED"] } } }),
      prisma.conversation.count({ where: { businessId: parsed.data.id, status: "OPEN", assignedUserId: null } }),
      prisma.conversation.count({ where: { businessId: parsed.data.id, status: "ASSIGNED", assignedAt: { lt: new Date(Date.now() - 5 * 60_000) } } }),
      prisma.conversation.count({ where: { businessId: parsed.data.id, status: "RESOLVED", resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    ]);
    const usage = await prisma.llmUsage.aggregate({ where: { businessId: parsed.data.id, at: { gte: from, lte: to } }, _sum: { costUsd: true } });
    const totalResolved = await prisma.conversation.count({ where: { businessId: parsed.data.id, status: "RESOLVED", resolvedAt: { gte: from, lte: to } } });
    const botResolved = await prisma.conversation.count({ where: { businessId: parsed.data.id, status: "RESOLVED", resolver: "BOT", resolvedAt: { gte: from, lte: to } } });
    return { open, unassigned, oldAssigned, resolvedToday: resolved, botResolutionPercent: totalResolved ? Number((botResolved / totalResolved * 100).toFixed(2)) : 0, llmCostUsd: usage._sum.costUsd?.toString() ?? "0", from, to };
  });

  app.get("/v1/businesses/:id/llm-usage", async (request, reply) => {
    const parsed = params.safeParse(request.params); if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, parsed.data.id, "metrics.view"); if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    return prisma.llmUsage.groupBy({ by: ["provider", "model", "botRuleId"], where: { businessId: parsed.data.id }, _sum: { promptTokens: true, completionTokens: true, costUsd: true }, orderBy: { _sum: { costUsd: "desc" } } });
  });
}
