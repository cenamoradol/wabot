import type { FastifyRequest } from "fastify";

export function validCsrf(request: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const header = request.headers["x-csrf-token"];
  return typeof header === "string" && header.length >= 32 && header === request.cookies.csrf;
}
