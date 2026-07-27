import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import "@fastify/cookie";
import { hashToken } from "./tokens.js";
import { hasPermission } from "../permissions.js";

export async function authenticate(request: FastifyRequest, prisma: PrismaClient) {
  const token = request.cookies.session;
  if (!token) return null;

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
  return session?.user ?? null;
}

export async function authorize(
  request: FastifyRequest,
  prisma: PrismaClient,
  businessId: string,
  permission: string,
) {
  const user = await authenticate(request, prisma);
  if (!user) return { status: 401 as const };

  const membership = await prisma.businessMember.findUnique({
    where: { userId_businessId: { userId: user.id, businessId } },
    include: { roleTemplate: true },
  });
  if (!membership?.roleTemplate) return { status: 404 as const };
  if (!hasPermission(
    membership.roleTemplate.permissions,
    membership.customPermissions,
    permission,
    user,
  )) return { status: 403 as const };

  return { status: 200 as const, user, membership };
}

// ponytail: isStaff bypasses granular RBAC; revisit before exposing to the internet.
export async function requireStaff(request: FastifyRequest, prisma: PrismaClient) {
  const user = await authenticate(request, prisma);
  if (!user) return { status: 401 as const, user: null };
  if (!user.isStaff) return { status: 403 as const, user: null };
  return { status: 200 as const, user };
}
