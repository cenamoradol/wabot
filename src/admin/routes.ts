import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireStaff } from "../auth/authorization.js";
import { validCsrf } from "../auth/csrf.js";
import { hashPassword, passwordPolicy } from "../auth/password.js";

const userIdParams = z.object({ id: z.string().cuid() });
const businessIdParams = z.object({ id: z.string().cuid() });
const userBody = z.object({
  email: z.email(),
  password: z.string().refine(passwordPolicy, "Password must be 8 to 128 characters"),
  name: z.string().trim().min(1).max(120).optional(),
  isStaff: z.boolean().optional(),
});

export function registerAdminRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const staffOnly = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const result = await requireStaff(request, prisma);
    if (result.status === 401) { reply.code(401).send({ error: "unauthorized" }); return null; }
    if (result.status === 403) { reply.code(403).send({ error: "forbidden" }); return null; }
    return result.user;
  };

  app.get("/v1/admin/users", async (request, reply) => {
    const user = await staffOnly(request, reply); if (!user) return;
    const rows = await prisma.user.findMany({
      select: { id: true, email: true, name: true, isStaff: true, createdAt: true, _count: { select: { memberships: true, sessions: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      isStaff: row.isStaff,
      createdAt: row.createdAt,
      membershipCount: row._count.memberships,
      sessionCount: row._count.sessions,
    }));
  });

  app.post("/v1/admin/users", async (request, reply) => {
    const user = await staffOnly(request, reply); if (!user) return;
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const parsed = userBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const email = parsed.data.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "email_in_use" });
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(parsed.data.password),
        passwordUpdatedAt: new Date(),
        isStaff: parsed.data.isStaff ?? false,
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
      },
      select: { id: true, email: true, name: true, isStaff: true, createdAt: true },
    });
    return reply.code(201).send(created);
  });

  app.delete("/v1/admin/users/:id", async (request, reply) => {
    const user = await staffOnly(request, reply); if (!user) return;
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const parsed = userIdParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    if (parsed.data.id === user.id) return reply.code(400).send({ error: "cannot_delete_self" });
    await prisma.user.delete({ where: { id: parsed.data.id } }).catch(() => null);
    return reply.code(204).send();
  });

  app.get("/v1/admin/businesses", async (request, reply) => {
    const user = await staffOnly(request, reply); if (!user) return;
    const rows = await prisma.business.findMany({
      select: { id: true, name: true, createdAt: true, _count: { select: { members: true, conversations: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      memberCount: row._count.members,
      conversationCount: row._count.conversations,
    }));
  });

  app.delete("/v1/admin/businesses/:id", async (request, reply) => {
    const user = await staffOnly(request, reply); if (!user) return;
    if (!validCsrf(request)) return reply.code(403).send({ error: "invalid_csrf" });
    const parsed = businessIdParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    await prisma.business.delete({ where: { id: parsed.data.id } }).catch(() => null);
    return reply.code(204).send();
  });
}
