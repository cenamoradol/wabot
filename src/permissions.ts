import { z } from "zod";

const actionSchema = z.record(z.string(), z.boolean());
export const permissionsSchema = z.object({
  modules: z.record(z.string(), actionSchema),
});

import type { User } from "@prisma/client";

export type Permissions = z.infer<typeof permissionsSchema>;

export function hasPermission(
  rolePermissions: unknown,
  customPermissions: unknown,
  permission: string,
  user?: Pick<User, "isStaff">,
): boolean {
  if (user?.isStaff) return true;
  const [module, action] = permission.split(".");
  if (!module || !action) return false;

  const role = permissionsSchema.safeParse(rolePermissions);
  const custom = customPermissions == null
    ? null
    : permissionsSchema.safeParse(customPermissions);
  if (!role.success || (custom && !custom.success)) return false;

  return custom?.data.modules[module]?.[action]
    ?? role.data.modules[module]?.[action]
    ?? false;
}
