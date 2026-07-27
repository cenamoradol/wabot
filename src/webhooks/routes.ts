import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { JobQueue } from "../jobs/queue.js";
import { parseWebhookPayload } from "./parser.js";
import { validWebhookSignature } from "./signature.js";

export function registerWebhookRoutes(app: FastifyInstance, options: {
  prisma: PrismaClient;
  queue: JobQueue;
  appSecret: string;
  verifyToken: string;
}) {
  const { prisma, queue, appSecret, verifyToken } = options;

  app.get("/webhook", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (query["hub.mode"] !== "subscribe" || query["hub.verify_token"] !== verifyToken || !query["hub.challenge"]) {
      return reply.code(403).send({ error: "verification_failed" });
    }
    return reply.type("text/plain").send(query["hub.challenge"]);
  });

  app.post("/webhook", async (request, reply) => {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) return reply.code(400).send({ error: "invalid_body" });
    const signature = request.headers["x-hub-signature-256"];
    if (!validWebhookSignature(rawBody, typeof signature === "string" ? signature : undefined, appSecret)) {
      await prisma.auditEvent.create({ data: { type: "webhook.signature_failed", payload: { ip: request.ip } } });
      return reply.code(401).send({ error: "invalid_signature" });
    }

    let changes;
    try {
      changes = parseWebhookPayload(rawBody);
    } catch {
      return reply.code(400).send({ error: "invalid_payload" });
    }

    for (const change of changes) {
      const phone = await prisma.phoneNumber.findUnique({ where: { phoneNumberId: change.phoneNumberId } });
      if (!phone) {
        await prisma.auditEvent.create({ data: { type: "webhook.unknown_phone", payload: { phoneNumberId: change.phoneNumberId, fingerprint: change.fingerprint } } });
        continue;
      }
      const event = await prisma.webhookEvent.upsert({
        where: { fingerprint: change.fingerprint },
        update: {},
        create: { ...change, payload: change.payload as Prisma.InputJsonObject, businessId: phone.businessId },
      });
      try {
        await queue.add("process", { webhookEventId: event.id }, { jobId: `webhook-${event.id}` });
      } catch (error) {
        request.log.error({ err: error, webhookEventId: event.id }, "webhook saved but enqueue failed");
      }
    }
    return reply.code(200).send({ received: true });
  });
}

export async function registerRawWebhookScope(parent: FastifyInstance, options: Parameters<typeof registerWebhookRoutes>[1]) {
  parent.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    registerWebhookRoutes(scope, options);
  });
}
