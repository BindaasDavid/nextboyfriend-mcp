export async function claude(system: string, user: string): Promise<string> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
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
