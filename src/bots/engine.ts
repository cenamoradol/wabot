export type Rule = { id: string; matchType: "KEYWORD" | "REGEX" | "AI"; pattern: string | null; priority: number; enabled: boolean };

export function matchesRule(rule: Rule, body: string) {
  if (!rule.enabled) return false;
  if (rule.matchType === "AI") return true;
  if (!rule.pattern || body.length > 4_000) return false;
  if (rule.matchType === "KEYWORD") return body.toLocaleLowerCase().includes(rule.pattern.toLocaleLowerCase());
  try { return new RegExp(rule.pattern, "iu").test(body); } catch { return false; }
}

export function firstMatchingRule(rules: Rule[], body: string) {
  return [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).find((rule) => matchesRule(rule, body));
}

export function shouldEscalate(input: { body: string; attemptNumber: number; maxAttempts?: number; sensitiveTerms?: string[] }) {
  const text = input.body.toLocaleLowerCase();
  if ((input.sensitiveTerms ?? ["abogado", "reclamo", "queja"]).some((term) => text.includes(term.toLocaleLowerCase()))) return "sensitive_term";
  if (/(humano|persona|agente|asesor)/iu.test(input.body)) return "human_requested";
  if (input.maxAttempts !== undefined && input.attemptNumber >= input.maxAttempts) return "attempt_limit";
  return null;
}
