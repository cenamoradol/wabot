import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhookPayload } from "../../src/webhooks/parser.js";
import { validWebhookSignature } from "../../src/webhooks/signature.js";

const secret = "test-secret";
const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone-1" }, messages: [] } }] }] }));

describe("webhook trust boundary", () => {
  it("verifies the exact raw bytes", () => {
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(validWebhookSignature(raw, signature, secret)).toBe(true);
    expect(validWebhookSignature(Buffer.concat([raw, Buffer.from(" ")]), signature, secret)).toBe(false);
    expect(validWebhookSignature(raw, "sha256=bad", secret)).toBe(false);
  });

  it("extracts routable changes", () => {
    const changes = parseWebhookPayload(raw);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.phoneNumberId).toBe("phone-1");
    expect(changes[0]?.type).toBe("messages");
  });
});
