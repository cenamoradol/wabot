import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { MetaClient } from "../adapters/meta.js";
import type { createObjectStorage } from "../infra/object-storage.js";

const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/webp",
  "application/pdf", "text/plain",
  "audio/aac", "audio/mpeg", "audio/ogg", "audio/mp4",
  "application/octet-stream",
]);
const maxBytes = 16 * 1024 * 1024;

export async function downloadMessageMedia(
  prisma: PrismaClient,
  meta: MetaClient,
  storage: ReturnType<typeof createObjectStorage>,
  messageId: string,
) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message?.providerMediaId || message.mediaLocalKey) return;

  try {
    const media = await meta.downloadMedia(message.providerMediaId);
    if (!allowedTypes.has(media.contentType)) throw new Error("Unsupported media type");
    if (media.contentLength && media.contentLength > maxBytes) throw new Error("Media exceeds 16 MiB limit");
    const key = `${message.conversationId}/${randomUUID()}`;
    await storage.put(key, media.body, media.contentType, media.contentLength);
    await prisma.message.update({
      where: { id: message.id },
      data: { mediaLocalKey: key, mediaMimeType: media.contentType, mediaByteSize: media.contentLength, mediaError: null },
    });
  } catch (error) {
    await prisma.message.update({
      where: { id: message.id },
      data: { mediaError: error instanceof Error ? error.message.slice(0, 1000) : "media_download_failed" },
    });
    throw error;
  }
}
