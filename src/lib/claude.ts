const DEFAULT_MCP_MODEL = "claude-sonnet-4-20250514";

export type ClaudeCallOptions = {
  /** Overrides `ANTHROPIC_MODEL` for this request (e.g. TikTok automation uses Haiku). */
  model?: string;
};

/** True when Anthropic rejected the request due to empty/low API credit balance. */
export function isAnthropicInsufficientCreditError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /credit balance|too low to access the anthropic api/i.test(msg);
}

export async function claude(
  system: string,
  user: string,
  options?: ClaudeCallOptions,
): Promise<string> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const model =
    (options?.model ?? "").trim() || (process.env.ANTHROPIC_MODEL ?? "").trim() || DEFAULT_MCP_MODEL;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    let suffix = "";
    try {
      const j = JSON.parse(body) as { error?: { message?: string } };
      const m = j.error?.message ?? "";
      if (/credit balance|too low/i.test(m)) {
        suffix =
          "\n→ Anthropic: add credits or upgrade at console.anthropic.com (Settings → Plans & billing). The key is valid; the workspace balance is empty.";
      }
    } catch {
      /* body not JSON */
    }
    throw new Error(`Claude API ${res.status}: ${body}${suffix}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  return data.content?.[0]?.text ?? "";
}
