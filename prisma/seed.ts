import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const defaultRoles = [
  ["Dueño", {
    modules: {
      chats: { view: true, respond: true, assign: true },
      metrics: { view: true },
      bots: { view: true, create: true, edit: true, delete: true },
      users: { view: true, create: true, edit: true, delete: true },
      config: { view: true, edit: true },
    },
  }],
  ["Administrador", {
    modules: {
      chats: { view: true, respond: true, assign: true },
      metrics: { view: true },
      bots: { view: true, create: true, edit: true, delete: true },
      users: { view: true, create: true, edit: true, delete: true },
      config: { view: true, edit: false },
    },
  }],
  ["Agente", {
    modules: {
      chats: { view: true, respond: true, assign: false },
      metrics: { view: false },
      bots: { view: false, create: false, edit: false, delete: false },
      users: { view: false, create: false, edit: false, delete: false },
      config: { view: false, edit: false },
    },
  }],
  ["Analista", {
    modules: {
      chats: { view: false, respond: false, assign: false },
      metrics: { view: true },
      bots: { view: false, create: false, edit: false, delete: false },
      users: { view: false, create: false, edit: false, delete: false },
      config: { view: false, edit: false },
    },
  }],
] as const;

async function main() {
  const ownerRole = await ensureRole("Dueño", defaultRoles[0][1]);
  const adminRole = await ensureRole("Administrador", defaultRoles[1][1]);
  await ensureRole("Agente", defaultRoles[2][1]);
  await ensureRole("Analista", defaultRoles[3][1]);

  await ensureSeedBusiness({
    name: "Tienda Demo",
    ownerEmail: process.env.SUPERADMIN_EMAIL ?? "demo@botwa.dev",
    ownerPassword: process.env.SUPERADMIN_PASSWORD ?? "correct horse battery staple",
    ownerRoleId: ownerRole.id,
    isStaff: true,
  });
  void adminRole;

  await prisma.$disconnect();
}

async function ensureRole(name: string, permissions: object) {
  const existing = await prisma.roleTemplate.findFirst({ where: { businessId: null, name } });
  return existing
    ? prisma.roleTemplate.update({ where: { id: existing.id }, data: { permissions, isDefault: true } })
    : prisma.roleTemplate.create({ data: { name, permissions, isDefault: true } });
}

async function ensureSeedBusiness({ name, ownerEmail, ownerPassword, ownerRoleId, isStaff }: {
  name: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerRoleId: string;
  isStaff: boolean;
}) {
  const email = ownerEmail.trim().toLowerCase();
  const passwordHash = await hash(ownerPassword);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, passwordUpdatedAt: new Date(), isStaff },
    create: { email, name: "Demo", passwordHash, passwordUpdatedAt: new Date(), isStaff },
  });
  const business = await prisma.business.findFirst({ where: { name } })
    ?? await prisma.business.create({ data: { name } });
  const membership = await prisma.businessMember.findUnique({
    where: { userId_businessId: { userId: user.id, businessId: business.id } },
  });
  if (!membership) {
    await prisma.businessMember.create({
      data: { userId: user.id, businessId: business.id, roleTemplateId: ownerRoleId },
    });
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
