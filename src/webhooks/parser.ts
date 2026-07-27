import { createHash } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      field: z.string(),
      value: z.object({
        metadata: z.object({ phone_number_id: z.string() }).passthrough(),
      }).passthrough(),
    })),
  })),
});

export type WebhookChange = {
  phoneNumberId: string;
  type: string;
  payload: Record<string, unknown>;
  fingerprint: string;
};

export function parseWebhookPayload(rawBody: Buffer): WebhookChange[] {
  const json: unknown = JSON.parse(rawBody.toString("utf8"));
  const parsed = payloadSchema.parse(json);
  const changes: WebhookChange[] = [];
  parsed.entry.forEach((entry, entryIndex) => entry.changes.forEach((change, changeIndex) => {
    const payload = change.value as Record<string, unknown>;
    changes.push({
      phoneNumberId: change.value.metadata.phone_number_id,
      type: change.field,
      payload,
      fingerprint: createHash("sha256").update(rawBody).update(`:${entryIndex}:${changeIndex}`).digest("hex"),
    });
  }));
  return changes;
}
