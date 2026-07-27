import { hash, verify } from "@node-rs/argon2";

export function passwordPolicy(value: string) {
  return value.length >= 8 && value.length <= 128;
}

// ponytail: argon2id default params (m=64MB, t=3, p=4); tune if a perf
// benchmark proves stronger memory cost is necessary.
export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (hashValue: string, password: string) => verify(hashValue, password);
