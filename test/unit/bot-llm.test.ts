import { describe, expect, it } from "vitest";
import { firstMatchingRule, shouldEscalate } from "../../src/bots/engine.js";
import { calculateCost, contextWindow, MockLlmClient } from "../../src/llm/client.js";

describe("bot engine", () => {
  it("picks by priority then id", () => {
    const rules = [
      { id: "b", matchType: "KEYWORD" as const, pattern: "hola", priority: 200, enabled: true },
      { id: "a", matchType: "KEYWORD" as const, pattern: "hola", priority: 100, enabled: true },
    ];
    expect(firstMatchingRule(rules, "HOla")?.id).toBe("a");
  });
  it("ignores invalid regex rules safely", () => {
    const rules = [{ id: "x", matchType: "REGEX" as const, pattern: "[", priority: 100, enabled: true }];
    expect(firstMatchingRule(rules, "hola")).toBeUndefined();
  });
  it("triggers escalation on sensitive terms", () => {
    expect(shouldEscalate({ body: "Quiero hablar con un humano", attemptNumber: 1 })).toBe("human_requested");
    expect(shouldEscalate({ body: "Pondré un abogado", attemptNumber: 1 })).toBe("sensitive_term");
    expect(shouldEscalate({ body: "ok", attemptNumber: 5, maxAttempts: 3 })).toBe("attempt_limit");
  });
});

describe("llm client", () => {
  it("computes exact decimal cost", () => {
    const cost = calculateCost(100, 50, "2.5", "10");
    expect(cost.toString()).toBe("0.00075");
  });
  it("keeps the conversation window bounded and ordered", () => {
    const window = contextWindow([{ direction: "INBOUND", authorType: "CONTACT", body: "hola" }, { direction: "OUTBOUND", authorType: "BOT", body: "como estás" }]);
    expect(window).toEqual([{ role: "user", content: "hola" }, { role: "assistant", content: "como estás" }]);
  });
  it("records mock requests", async () => {
    const mock = new MockLlmClient("hola");
    const result = await mock.chat({ systemPrompt: "s", messages: [], model: "x", maxTokens: 1 });
    expect(result.reply).toBe("hola");
    expect(mock.requests).toHaveLength(1);
  });
});
