import { socialApi } from "../lib/social.js";

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

/** Best-effort: SocialAPI account list shapes vary — try common patterns. */
function listAccountsFromResponse(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  const top = asRecord(raw);
  if (!top) {
    return [];
  }
  const data = top.data;
  if (Array.isArray(data)) {
    return data.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  const accounts = top.accounts;
  if (Array.isArray(accounts)) {
    return accounts.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  return [];
}

function isTikTokAccount(row: Record<string, unknown>): boolean {
  const p = String(row.platform ?? row.provider ?? row.network ?? row.type ?? "").toLowerCase();
  const n = String(row.name ?? row.username ?? "").toLowerCase();
  return p.includes("tiktok") || n.includes("tiktok");
}

/**
 * TikTok account id for SocialAPI `targets`.
 * Prefer `AUTOMATION_TIKTOK_ACCOUNT_ID`; else first TikTok-looking account from GET /accounts.
 */
export async function resolveTikTokAccountId(): Promise<string> {
  const envId = (process.env.AUTOMATION_TIKTOK_ACCOUNT_ID ?? "").trim();
  if (envId) {
    return envId;
  }
  const raw = await socialApi("/accounts");
  const rows = listAccountsFromResponse(raw);
  const tik = rows.find(isTikTokAccount);
  const id = tik?.id ?? tik?.account_id ?? tik?.accountId;
  if (id !== undefined && id !== null && String(id)) {
    return String(id);
  }
  throw new Error(
    "No TikTok account: set AUTOMATION_TIKTOK_ACCOUNT_ID or connect TikTok in SocialAPI and ensure /accounts returns it.",
  );
}
