import { Queue } from "bullmq";
import { buildApp } from "./app.js";
import { GraphApiMetaClient, MockMetaClient } from "./adapters/meta.js";
import { loadConfig } from "./config.js";
import { ConsoleEmailSender, ResendEmailSender } from "./auth/email.js";
import { createObjectStorage } from "./infra/object-storage.js";
import { prisma } from "./infra/prisma.js";
import { createRedis } from "./infra/redis.js";

const config = loadConfig();
const redis = createRedis(config.REDIS_URL);
const realtimeSubscriber = createRedis(config.REDIS_URL);
const storage = createObjectStorage(config);
const webhookQueue = new Queue("webhook-events", { connection: redis });
const messageQueue = new Queue("messages", { connection: redis });
const publisher = {
  publish: (businessId: string, event: { type: string; id: string }) => redis.publish(`business:${businessId}`, JSON.stringify(event)).then(() => undefined),
};
const meta = config.NODE_ENV === "production"
  ? new GraphApiMetaClient(config.META_ACCESS_TOKEN, config.META_GRAPH_API_VERSION)
  : new MockMetaClient();
const emailSender = config.RESEND_API_KEY
  ? new ResendEmailSender(config.RESEND_API_KEY, config.EMAIL_FROM)
  : new ConsoleEmailSender();
if (!config.RESEND_API_KEY) {
  console.warn("[botwa] RESEND_API_KEY no está definida; usando ConsoleEmailSender (enlaces se imprimen en el log del servidor).");
}
const app = buildApp({
  prisma,
  appUrl: config.APP_URL,
  webOrigin: config.WEB_ORIGIN,
  secureCookies: config.NODE_ENV === "production",
  meta,
  webhookQueue,
  metaAppSecret: config.META_APP_SECRET,
  metaVerifyToken: config.META_WEBHOOK_VERIFY_TOKEN,
  metaAppId: config.META_APP_ID,
  metaConfigId: config.META_CONFIG_ID,
  metaRedirectUri: config.META_REDIRECT_URI,
  messageQueue,
  publisher,
  realtimeSubscriber,
  emailSender,
  checks: [
    () => prisma.$queryRaw`SELECT 1`.then(() => undefined),
    () => redis.ping().then(() => undefined),
  ],
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await Promise.all([webhookQueue.close(), messageQueue.close()]);
  await Promise.all([prisma.$disconnect(), redis.quit(), realtimeSubscriber.quit(), storage.client.destroy()]);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(`botwa listening on ${config.HOST}:${config.PORT}`);
