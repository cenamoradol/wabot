import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

export type PhoneSetup = {
  phoneNumberId: string;
  displayPhone: string;
  displayName: string;
};

export type EmbeddedSignupConfig = {
  configId: string;
  redirectUri: string;
  state: string;
};

export type ExchangedToken = {
  accessToken: string;
  expiresAt: Date;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  displayName: string;
};

export interface MetaClient {
  startPhoneSetup(input: { configId: string; redirectUri: string; state: string }): Promise<EmbeddedSignupConfig>;
  startMockSetup(input: { displayPhone: string; displayName: string }): Promise<PhoneSetup>;
  verifyPhone(input: { phoneNumberId: string; code: string; accessToken?: string }): Promise<void>;
  disconnectPhone(input: { phoneNumberId: string }): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ body: Readable; contentType: string; contentLength?: number }>;
  sendMessage(input: { phoneNumberId: string; to: string; type: "TEXT" | "IMAGE" | "DOCUMENT"; body?: string; mediaId?: string }): Promise<{ waMessageId: string }>;
  exchangeCode(input: { code: string; redirectUri: string; appId: string; appSecret: string }): Promise<ExchangedToken>;
  subscribeWebhook(input: { wabaId: string; accessToken: string; callbackUrl: string; verifyToken: string }): Promise<void>;
}

export class MockMetaClient implements MetaClient {
  async startPhoneSetup(_input: { configId: string; redirectUri: string; state: string }): Promise<EmbeddedSignupConfig> {
    return { configId: "mock-config-id", redirectUri: "http://localhost:5173/v1/auth/meta/callback", state: "mock-state" };
  }
  async startMockSetup(input: { displayPhone: string; displayName: string }): Promise<PhoneSetup> {
    return {
      phoneNumberId: `mock-${input.displayPhone.replace(/\D/g, "")}`,
      ...input,
    };
  }
  async verifyPhone(input: { phoneNumberId: string; code: string }) {
    if (!input.phoneNumberId.startsWith("mock-") && !input.phoneNumberId.startsWith("mock-graph-") || input.code !== "123456") {
      throw new Error("Invalid mock verification code");
    }
  }
  async disconnectPhone(_input: { phoneNumberId: string }) {
    // no-op en mock: el borrado local es la fuente de verdad en dev.
  }
  async downloadMedia(mediaId: string) {
    const body = Buffer.from(`mock media ${mediaId}`);
    return { body: Readable.from(body), contentType: "application/octet-stream", contentLength: body.length };
  }
  async sendMessage() {
    return { waMessageId: `mock-${randomUUID()}` };
  }
  async exchangeCode(_input: { code: string; redirectUri: string; appId: string; appSecret: string }): Promise<ExchangedToken> {
    return {
      accessToken: "mock-user-access-token",
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60_000),
      wabaId: "mock-waba-id",
      phoneNumberId: `mock-graph-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      displayPhone: "+5491155556666",
      displayName: "Mock WABA",
    };
  }
  async subscribeWebhook(_input: { wabaId: string; accessToken: string; callbackUrl: string; verifyToken: string }) {
    // no-op en mock
  }
}

export class GraphApiMetaClient implements MetaClient {
  constructor(
    private readonly token: string,
    private readonly version: string,
  ) {}

  async startPhoneSetup(input: { configId: string; redirectUri: string; state: string }): Promise<EmbeddedSignupConfig> {
    if (!input.configId) throw new Error("META_CONFIG_ID is required for Embedded Signup");
    return { configId: input.configId, redirectUri: input.redirectUri, state: input.state };
  }
  async startMockSetup(input: { displayPhone: string; displayName: string }): Promise<PhoneSetup> {
    if (!input.displayPhone) throw new Error("META_ACCESS_TOKEN missing for real phone setup");
    return {
      phoneNumberId: `mock-${input.displayPhone.replace(/\D/g, "")}`,
      ...input,
    };
  }

  async verifyPhone(input: { phoneNumberId: string; code: string; accessToken?: string }) {
    const response = await fetch(`https://graph.facebook.com/${this.version}/${input.phoneNumberId}/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken ?? this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: input.code }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Meta verification failed with ${response.status}`);
  }

  async disconnectPhone(input: { phoneNumberId: string }) {
    const response = await fetch(`https://graph.facebook.com/${this.version}/${input.phoneNumberId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Meta deregister failed with ${response.status}`);
    }
  }

  async downloadMedia(mediaId: string) {
    const metadataResponse = await fetch(`https://graph.facebook.com/${this.version}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!metadataResponse.ok) throw new Error(`Meta media metadata failed with ${metadataResponse.status}`);
    const metadata = await metadataResponse.json() as { url?: string; mime_type?: string; file_size?: number };
    if (!metadata.url) throw new Error("Meta media URL missing");
    if (metadata.file_size && metadata.file_size > 16 * 1024 * 1024) throw new Error("Media exceeds 16 MiB limit");
    const mediaResponse = await fetch(metadata.url, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!mediaResponse.ok || !mediaResponse.body) throw new Error(`Meta media download failed with ${mediaResponse.status}`);
    return {
      body: Readable.fromWeb(mediaResponse.body as import("node:stream/web").ReadableStream),
      contentType: metadata.mime_type ?? mediaResponse.headers.get("content-type") ?? "application/octet-stream",
      ...(metadata.file_size ? { contentLength: metadata.file_size } : {}),
    };
  }

  async sendMessage(input: { phoneNumberId: string; to: string; type: "TEXT" | "IMAGE" | "DOCUMENT"; body?: string; mediaId?: string }) {
    const type = input.type.toLowerCase();
    const content = input.type === "TEXT"
      ? { body: input.body }
      : { id: input.mediaId, ...(input.body ? { caption: input.body } : {}) };
    const response = await fetch(`https://graph.facebook.com/${this.version}/${input.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: input.to, type, [type]: content }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Meta send failed with ${response.status}`);
    const result = await response.json() as { messages?: Array<{ id?: string }> };
    const waMessageId = result.messages?.[0]?.id;
    if (!waMessageId) throw new Error("Meta response missing message id");
    return { waMessageId };
  }

  async exchangeCode(input: { code: string; redirectUri: string; appId: string; appSecret: string }): Promise<ExchangedToken> {
    const tokenUrl = new URL(`https://graph.facebook.com/${this.version}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", input.appId);
    tokenUrl.searchParams.set("client_secret", input.appSecret);
    tokenUrl.searchParams.set("redirect_uri", input.redirectUri);
    tokenUrl.searchParams.set("code", input.code);
    const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(10_000) });
    if (!tokenRes.ok) throw new Error(`Meta short-lived token exchange failed with ${tokenRes.status}`);
    const shortLived = await tokenRes.json() as { access_token?: string };
    if (!shortLived.access_token) throw new Error("Meta short-lived exchange missing access_token");

    const longUrl = new URL(`https://graph.facebook.com/${this.version}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", input.appId);
    longUrl.searchParams.set("client_secret", input.appSecret);
    longUrl.searchParams.set("fb_exchange_token", shortLived.access_token);
    const longRes = await fetch(longUrl, { signal: AbortSignal.timeout(10_000) });
    if (!longRes.ok) throw new Error(`Meta long-lived token exchange failed with ${longRes.status}`);
    const longLived = await longRes.json() as { access_token?: string; expires_in?: number };
    if (!longLived.access_token) throw new Error("Meta long-lived exchange missing access_token");
    const expiresIn = longLived.expires_in ?? 60 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const debugUrl = new URL(`https://graph.facebook.com/${this.version}/debug_token`);
    debugUrl.searchParams.set("input_token", longLived.access_token);
    debugUrl.searchParams.set("access_token", this.token);
    const debugRes = await fetch(debugUrl, { signal: AbortSignal.timeout(10_000) });
    if (!debugRes.ok) throw new Error(`Meta debug_token failed with ${debugRes.status}`);
    const debug = await debugRes.json() as { data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } };
    const wabaScope = debug.data?.granular_scopes?.find((s) => s.scope === "whatsapp_business_management");
    const wabaId = wabaScope?.target_ids?.[0];
    if (!wabaId) throw new Error("Meta token has no whatsapp_business_management WABA scope");

    const wabaUrl = new URL(`https://graph.facebook.com/${this.version}/${wabaId}/phone_numbers`);
    const wabaRes = await fetch(wabaUrl, {
      headers: { Authorization: `Bearer ${longLived.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!wabaRes.ok) throw new Error(`Meta WABA phone_numbers failed with ${wabaRes.status}`);
    const waba = await wabaRes.json() as { data?: Array<{ id: string; display_phone_number: string; verified_name?: string }> };
    const phone = waba.data?.[0];
    if (!phone) throw new Error("WABA has no phone numbers");
    return {
      accessToken: longLived.access_token,
      expiresAt,
      wabaId,
      phoneNumberId: phone.id,
      displayPhone: phone.display_phone_number,
      displayName: phone.verified_name ?? "WhatsApp Business",
    };
  }

  async subscribeWebhook(input: { wabaId: string; accessToken: string; callbackUrl: string; verifyToken: string }) {
    const url = new URL(`https://graph.facebook.com/${this.version}/${input.wabaId}/subscribed_apps`);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ override_callback_uri: input.callbackUrl, verify_token: input.verifyToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Meta subscribe webhook failed with ${response.status}: ${text.slice(0, 200)}`);
    }
  }
}
