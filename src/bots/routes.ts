import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorize } from "../auth/authorization.js";
import { validCsrf } from "../auth/csrf.js";

const params = z.object({ id: z.string().cuid() });
const ruleBody = z.object({ name: z.string().trim().min(1).max(120), matchType: z.enum(["KEYWORD", "REGEX", "AI"]), pattern: z.string().max(500).nullable().optional(), priority: z.number().int().min(0).max(100_000).default(100), enabled: z.boolean().default(true), responseType: z.enum(["TEXT", "LLM"]), response: z.string().max(4096).nullable().optional(), systemPrompt: z.string().max(4000).nullable().optional(), escalateAfterAttempts: z.number().int().min(1).max(20).nullable().optional() });

export function registerBotRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/v1/businesses/:id/bot-rules", async (request, reply) => {
    const parsed = params.safeParse(request.params); if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, parsed.data.id, "bots.view"); if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    return prisma.botRule.findMany({ where: { businessId: parsed.data.id }, orderBy: [{ priority: "asc" }, { id: "asc" }] });
  });
  app.post("/v1/businesses/:id/bot-rules", async (request, reply) => {
    const parsed = params.safeParse(request.params); const body = ruleBody.safeParse(request.body);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" }); if (!body.success) return reply.code(400).send({ error: "invalid_request" }); if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, parsed.data.id, "bots.create"); if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    if (body.data.matchType === "REGEX") { try { new RegExp(body.data.pattern ?? ""); } catch { return reply.code(400).send({ error: "invalid_regex" }); } }
    return reply.code(201).send(await prisma.botRule.create({ data: { businessId: parsed.data.id, ...body.data } }));
  });
  app.patch("/v1/businesses/:id/bot-rules/:ruleId", async (request, reply) => {
    const route = z.object({ id: z.string().cuid(), ruleId: z.string().cuid() }).safeParse(request.params); const body = ruleBody.partial().safeParse(request.body);
    if (!route.success) return reply.code(404).send({ error: "not_found" }); if (!body.success) return reply.code(400).send({ error: "invalid_request" }); if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, route.data.id, "bots.edit"); if (auth.status !== 200) return reply.code(auth.status === 401 ? 401 : auth.status === 403 ? 403 : 404).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    return prisma.botRule.updateMany({ where: { id: route.data.ruleId, businessId: route.data.id }, data: body.data });
  });
}
