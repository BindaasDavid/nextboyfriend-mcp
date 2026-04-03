/** Parse JSON from Claude output, including optional ```json fences. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : trimmed).trim();
  return JSON.parse(raw) as Record<string, unknown>;
}
