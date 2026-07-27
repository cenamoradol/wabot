import { describe, expect, it } from "vitest";
import { hasPermission } from "../../src/permissions.js";
import { hashPassword, passwordPolicy, verifyPassword } from "../../src/auth/password.js";

const role = { modules: { chats: { view: true, assign: false } } };

describe("permissions", () => {
  it("lets custom permissions override a role", () => {
    expect(hasPermission(role, { modules: { chats: { assign: true } } }, "chats.assign")).toBe(true);
    expect(hasPermission(role, null, "chats.assign")).toBe(false);
  });

  it("rejects malformed permissions", () => {
    expect(hasPermission({}, null, "chats.view")).toBe(false);
  });
});

describe("password hashing", () => {
  it("roundtrips a real password through argon2id", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("enforces the policy range", () => {
    expect(passwordPolicy("short")).toBe(false);
    expect(passwordPolicy("a".repeat(8))).toBe(true);
    expect(passwordPolicy("a".repeat(128))).toBe(true);
    expect(passwordPolicy("a".repeat(129))).toBe(false);
  });
});
