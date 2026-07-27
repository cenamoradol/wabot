import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../auth/authorization.js";
import { validCsrf } from "../auth/csrf.js";

const businessBody = z.object({ name: z.string().trim().min(2).max(120) });
const businessParams = z.object({ id: z.string().cuid() });

export function registerBusinessRoutes(app: FastifyInstance, prisma: PrismaClient) {
  app.get("/v1/businesses", async (request, reply) => {
    const user = await authenticate(request, prisma);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return prisma.business.findMany({
      where: { members: { some: { userId: user.id } } },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  });

  app.post("/v1/businesses", async (request, reply) => {
    const user = await authenticate(request, prisma);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const parsed = businessBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const business = await prisma.$transaction(async (tx) => {
      const owner = await tx.roleTemplate.findFirstOrThrow({ where: { businessId: null, name: "Dueño", isDefault: true } });
      return tx.business.create({
        data: {
          name: parsed.data.name,
          members: { create: { userId: user.id, roleTemplateId: owner.id } },
          auditEvents: { create: { userId: user.id, type: "business.created", payload: { name: parsed.data.name } } },
        },
        select: { id: true, name: true, createdAt: true },
      });
    });
    return reply.code(201).send(business);
  });

  app.get("/v1/businesses/:id", async (request, reply) => {
    const params = businessParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    const auth = await authorize(request, prisma, params.data.id, "config.view");
    if (auth.status !== 200) return reply.code(auth.status).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    return prisma.business.findUnique({ where: { id: params.data.id }, select: { id: true, name: true, createdAt: true } });
  });

  app.patch("/v1/businesses/:id", async (request, reply) => {
    const params = businessParams.safeParse(request.params);
    const body = businessBody.safeParse(request.body);
    if (!params.success) return reply.code(404).send({ error: "not_found" });
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const auth = await authorize(request, prisma, params.data.id, "config.edit");
    if (auth.status !== 200) return reply.code(auth.status).send({ error: auth.status === 401 ? "unauthorized" : auth.status === 403 ? "forbidden" : "not_found" });
    return prisma.business.update({ where: { id: params.data.id }, data: { name: body.data.name }, select: { id: true, name: true, createdAt: true } });
  });
}
