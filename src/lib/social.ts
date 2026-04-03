const SOCIAL_BASE = "https://api.social-api.ai/v1";

function bearer(): string {
  return (process.env.SOCAPI_KEY ?? process.env.SOCIAL_API_KEY ?? "").trim();
}

export async function socialApi(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const token = bearer();
  if (!token) {
    throw new Error("SOCAPI_KEY or SOCIAL_API_KEY is not set");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${SOCIAL_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`SocialAPI ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<unknown>;
}
