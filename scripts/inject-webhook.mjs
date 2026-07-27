import { createHmac } from "node:crypto";

const secret = "replace-me";
const phoneNumberId = process.argv[2];
const body = process.argv[3] ?? "hola, quiero informacion";
const id = `wamid.demo-${Date.now()}`;
const timestamp = Math.floor(Date.now() / 1000).toString();

const payload = {
  object: "whatsapp_business_account",
  entry: [{
    id: "waba",
    changes: [{
      field: "messages",
      value: {
        metadata: { phone_number_id: phoneNumberId },
        contacts: [{ wa_id: "5491100001111", profile: { name: "Cliente Demo" } }],
        messages: [{ id, from: "5491100001111", timestamp, type: "text", text: { body } }],
      },
    }],
  }],
};

const raw = JSON.stringify(payload);
const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
const response = await fetch("http://127.0.0.1:3000/webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
  body: raw,
});
console.log("HTTP", response.status, await response.text());
console.log("messageId", id);
