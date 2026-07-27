import websocket from "@fastify/websocket";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type WebSocket from "ws";
import type { RawData } from "ws";
import { authenticate } from "../auth/authorization.js";

export async function registerRealtimeRoutes(app: FastifyInstance, prisma: PrismaClient, subscriber: Redis) {
  app.register(websocket);
  const sockets = new Map<string, Set<WebSocket>>();

  subscriber.on("message", (channel, message) => {
    for (const socket of sockets.get(channel) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  });

  app.get("/v1/realtime", { websocket: true }, async (socket, request) => {
    const user = await authenticate(request, prisma);
    if (!user) return socket.close(1008, "unauthorized");
    let channel: string | null = null;

    socket.on("message", async (raw: RawData) => {
      let businessId: string | undefined;
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; businessId?: string };
        if (message.type === "subscribe") businessId = message.businessId;
      } catch { return socket.close(1003, "invalid message"); }
      if (!businessId) return socket.close(1003, "invalid message");
      const membership = await prisma.businessMember.findUnique({ where: { userId_businessId: { userId: user.id, businessId } } });
      if (!membership) return socket.close(1008, "not found");

      if (channel) sockets.get(channel)?.delete(socket);
      channel = `business:${businessId}`;
      const set = sockets.get(channel) ?? new Set<WebSocket>();
      set.add(socket);
      sockets.set(channel, set);
      await subscriber.subscribe(channel);
      socket.send(JSON.stringify({ type: "subscribed", businessId }));
    });

    socket.on("close", async () => {
      if (!channel) return;
      const set = sockets.get(channel);
      set?.delete(socket);
      if (!set?.size) {
        sockets.delete(channel);
        await subscriber.unsubscribe(channel);
      }
    });
  });
}
