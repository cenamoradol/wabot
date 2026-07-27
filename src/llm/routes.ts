import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorize } from "../auth/authorization.js";
import { validCsrf } from "../auth/csrf.js";

const params = z.object({ id: z.string().cuid() });
const configBody = z.object({ provider: z.enum(["mock", "custom"]), model: z.string().min(1).max(120), temperature: z.number().min(0).max(2).default(0.7), maxTokens: z.number().int().min(1).max(4000).default(500), costPerMillionPromptTokens: z.string().regex(/^\d+(\.\d{1,8})?$/), costPerMillionCompletionTokens: z.string().regex(/^\d+(\.\d{1,8})?$/), monthlyCapUsd: z.string().regex(/^\d+(\.\d{1,8})?$/) });

export function registerLlmRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/v1/businesses/:id/llm-config", async (request, reply) => {
    const parsed = params.safeParse(request.params); if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, parsed.data.id, "config.view"); if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    return prisma.llmConfig.findUnique({ where: { businessId: parsed.data.id }, select: { provider: true, model: true, temperature: true, maxTokens: true, costPerMillionPromptTokens: true, costPerMillionCompletionTokens: true, monthlyCapUsd: true } });
  });
  app.post("/v1/businesses/:id/llm-config", async (request, reply) => {
    const parsed = params.safeParse(request.params); const body = configBody.safeParse(request.body);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" }); if (!body.success) return reply.code(400).send({ error: "invalid_request" }); if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, parsed.data.id, "config.edit"); if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    const saved = await prisma.llmConfig.upsert({ where: { businessId: parsed.data.id }, create: { businessId: parsed.data.id, ...body.data }, update: body.data, select: { provider: true, model: true, temperature: true, maxTokens: true, costPerMillionPromptTokens: true, costPerMillionCompletionTokens: true, monthlyCapUsd: true } });
    return reply.code(200).send(saved);
  });
}
