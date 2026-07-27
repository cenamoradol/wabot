import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { registerLlmRoutes } from "./llm/routes.js";
import type { MetaClient } from "./adapters/meta.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { registerAuthRoutes } from "./auth/routes.js";
import type { EmailSender } from "./auth/email.js";
import { registerBotRoutes } from "./bots/routes.js";
import { registerMetricRoutes } from "./metrics/routes.js";
import { registerBusinessRoutes } from "./businesses/routes.js";
import { registerConversationRoutes } from "./conversations/routes.js";
import type { JobQueue } from "./jobs/queue.js";
import type { createObjectStorage } from "./infra/object-storage.js";
import { registerMessageRoutes } from "./messages/routes.js";
import { registerPhoneNumberRoutes } from "./phone-number/routes.js";
import { registerMetaAuthRoutes } from "./auth/meta-routes.js";
import type { Redis } from "ioredis";
import type { EventPublisher } from "./realtime/publisher.js";
import { registerRealtimeRoutes } from "./realtime/routes.js";
import { registerRawWebhookScope } from "./webhooks/routes.js";

export type ReadinessCheck = () => Promise<void>;

export type AppOptions = {
  checks?: ReadinessCheck[];
  prisma?: PrismaClient;
  appUrl?: string;
  webOrigin?: string;
  secureCookies?: boolean;
  meta?: MetaClient;
  webhookQueue?: JobQueue;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  metaAppId?: string;
  metaConfigId?: string;
  metaRedirectUri?: string;
  messageQueue?: JobQueue;
  publisher?: EventPublisher;
  realtimeSubscriber?: Redis;
  storage?: ReturnType<typeof createObjectStorage>;
  emailSender?: EmailSender;
};

export function buildApp(options: AppOptions | ReadinessCheck[] = {}) {
  const normalized = Array.isArray(options) ? { checks: options } : options;
  const checks = normalized.checks ?? [];
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-csrf-token",
        "req.headers.x-hub-signature-256",
      ],
    },
  });

  void app.register(cookie);
  if (normalized.webOrigin) {
    void app.register(cors, { origin: normalized.webOrigin, credentials: true });
  }

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    const results = await Promise.allSettled(checks.map((check) => check()));
    if (results.some((result) => result.status === "rejected")) {
      return reply.code(503).send({ status: "unavailable" });
    }
    return { status: "ok" };
  });

  if (normalized.prisma && normalized.appUrl && normalized.emailSender) {
    registerAuthRoutes(app, normalized.prisma, {
      secureCookies: normalized.secureCookies ?? false,
      emailSender: normalized.emailSender,
      appUrl: normalized.appUrl,
    });
    registerBusinessRoutes(app, normalized.prisma);
    registerBotRoutes(app, normalized.prisma);
    registerMetricRoutes(app, normalized.prisma);
    registerLlmRoutes(app, normalized.prisma);
    registerAdminRoutes(app, normalized.prisma);
    if (normalized.meta) registerPhoneNumberRoutes(app, normalized.prisma, normalized.meta);
    if (normalized.publisher) registerConversationRoutes(app, normalized.prisma, normalized.publisher);
    if (normalized.realtimeSubscriber) void registerRealtimeRoutes(app, normalized.prisma, normalized.realtimeSubscriber);
    if (normalized.messageQueue) registerMessageRoutes(app, normalized.prisma, normalized.messageQueue, normalized.storage);
    if (normalized.webhookQueue && normalized.metaAppSecret && normalized.metaVerifyToken) {
      void registerRawWebhookScope(app, {
        prisma: normalized.prisma,
        queue: normalized.webhookQueue,
        appSecret: normalized.metaAppSecret,
        verifyToken: normalized.metaVerifyToken,
      });
    }
    if (normalized.meta && normalized.metaAppSecret && normalized.metaVerifyToken && normalized.metaAppId && normalized.metaConfigId && normalized.metaRedirectUri) {
      registerMetaAuthRoutes(app, {
        prisma: normalized.prisma,
        meta: normalized.meta,
        appId: normalized.metaAppId,
        appSecret: normalized.metaAppSecret,
        configId: normalized.metaConfigId,
        redirectUri: normalized.metaRedirectUri,
        webhookUrl: `${normalized.appUrl.replace(/\/$/, "")}/webhook`,
        webhookVerifyToken: normalized.metaVerifyToken,
      });
      app.get("/v1/config", async () => ({
        metaAppId: normalized.metaAppId,
        embeddedSignupEnabled: true,
      }));
    } else {
      app.get("/v1/config", async () => ({
        metaAppId: normalized.metaAppId ?? "",
        embeddedSignupEnabled: false,
      }));
    }
  }

  return app;
}
