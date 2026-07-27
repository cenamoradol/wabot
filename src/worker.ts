import { evaluateBotMessage } from "./bots/worker.js";
import { Queue, Worker } from "bullmq";
import { GraphApiMetaClient, MockMetaClient } from "./adapters/meta.js";
import { loadConfig } from "./config.js";
import { createObjectStorage } from "./infra/object-storage.js";
import { prisma } from "./infra/prisma.js";
import { createRedis } from "./infra/redis.js";
import { downloadMessageMedia } from "./jobs/media-worker.js";
import { sendOutboundMessage } from "./jobs/send-message.js";
import { processWebhookEvent, recoverWebhookEvents } from "./jobs/webhook-worker.js";

const config = loadConfig();
const connection = createRedis(config.REDIS_URL);
const storage = createObjectStorage(config);
const meta = config.NODE_ENV === "production"
  ? new GraphApiMetaClient(config.META_ACCESS_TOKEN, config.META_GRAPH_API_VERSION)
  : new MockMetaClient();
const webhookQueue = new Queue("webhook-events", { connection });
const mediaQueue = new Queue("media", { connection });
const messageQueue = new Queue("messages", { connection });
const botQueue = new Queue("bot", { connection });
const publisher = {
  publish: (businessId: string, event: { type: string; id: string }) => connection.publish(`business:${businessId}`, JSON.stringify(event)).then(() => undefined),
};

const systemWorker = new Worker("system", async (job) => {
  if (job.name !== "ping") throw new Error(`Unknown job: ${job.name}`);
  return { pong: true };
}, { connection });

const webhookWorker = new Worker("webhook-events", async (job) => {
  if (job.name === "process") {
    const webhookEventId = job.data.webhookEventId;
    if (typeof webhookEventId !== "string") throw new Error("Missing webhookEventId");
    return processWebhookEvent(prisma, webhookEventId, mediaQueue, botQueue);
  }
  if (job.name === "recover") return recoverWebhookEvents(prisma, webhookQueue);
  throw new Error(`Unknown webhook job: ${job.name}`);
}, { connection, concurrency: 10 });

const mediaWorker = new Worker("media", async (job) => {
  if (job.name !== "download" || typeof job.data.messageId !== "string") throw new Error("Invalid media job");
  return downloadMessageMedia(prisma, meta, storage, job.data.messageId);
}, { connection, concurrency: 4 });

const messageWorker = new Worker("messages", async (job) => {
  if (job.name !== "send" || typeof job.data.messageId !== "string") throw new Error("Invalid message job");
  return sendOutboundMessage(prisma, meta, publisher, job.data.messageId);
}, { connection, concurrency: 10 });

const botWorker = new Worker("bot", async (job) => {
  if (job.name !== "evaluate" || typeof job.data.messageId !== "string") throw new Error("Invalid bot job");
  return evaluateBotMessage(prisma, job.data.messageId, messageQueue);
}, { connection, concurrency: 5 });

await webhookQueue.upsertJobScheduler("recover-webhooks", { every: 120_000 }, { name: "recover", data: {} });

async function shutdown() {
  await Promise.all([systemWorker.close(), webhookWorker.close(), mediaWorker.close(), messageWorker.close(), botWorker.close()]);
  await Promise.all([webhookQueue.close(), mediaQueue.close(), messageQueue.close(), botQueue.close()]);
  storage.client.destroy();
  await prisma.$disconnect();
  await connection.quit();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
