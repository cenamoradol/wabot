import { Prisma } from "@prisma/client";

export type LlmMessage = { role: "user" | "assistant"; content: string };
export type LlmRequest = { systemPrompt: string; messages: LlmMessage[]; model: string; temperature?: number; maxTokens: number };
export type LlmResult = { reply: string; promptTokens: number; completionTokens: number };
export interface LlmClient { chat(request: LlmRequest): Promise<LlmResult>; }

export class MockLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly reply = "Respuesta simulada") {}
  async chat(request: LlmRequest) { this.requests.push(request); return { reply: this.reply, promptTokens: 10, completionTokens: 5 }; }
}

export function calculateCost(promptTokens: number, completionTokens: number, promptRate: Prisma.Decimal.Value, completionRate: Prisma.Decimal.Value) {
  return new Prisma.Decimal(promptTokens).mul(promptRate).plus(new Prisma.Decimal(completionTokens).mul(completionRate)).div(1_000_000);
}

export function contextWindow(messages: Array<{ direction: "INBOUND" | "OUTBOUND"; authorType: string; body: string | null }>, limit = 20): LlmMessage[] {
  return messages.filter((message): message is typeof message & { body: string } => Boolean(message.body)).slice(-limit).map((message) => ({ role: message.direction === "INBOUND" ? "user" : "assistant", content: message.body }));
}
