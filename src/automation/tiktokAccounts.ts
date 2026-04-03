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

function normalizeHandle(s: string): string {
  return s.trim().toLowerCase().replace(/^@/, "");
}

function rowMatchesEnvId(row: Record<string, unknown>, envNormalized: string): boolean {
  const ids = [
    row.id,
    row.account_id,
    row.accountId,
    row.username,
    row.name,
    row.handle,
    row.slug,
  ]
    .filter((x) => x !== undefined && x !== null)
    .map((x) => normalizeHandle(String(x)));
  return ids.some((id) => id === envNormalized || id.endsWith(envNormalized));
}

/**
 * TikTok account id for SocialAPI `targets`.
 * `AUTOMATION_TIKTOK_ACCOUNT_ID` may be an internal id **or** a handle (e.g. nextboyfriend_community);
 * we match GET /accounts and prefer the API’s canonical `id` when found.
 */
export async function resolveTikTokAccountId(): Promise<string> {
  const envId = (process.env.AUTOMATION_TIKTOK_ACCOUNT_ID ?? "").trim();
  const raw = await socialApi("/accounts");
  const rows = listAccountsFromResponse(raw);

  if (envId) {
    const want = normalizeHandle(envId);
    const tikTokRows = rows.filter(isTikTokAccount);
    const byEnv = tikTokRows.find((r) => rowMatchesEnvId(r, want));
    if (byEnv) {
      const canonical = byEnv.id ?? byEnv.account_id ?? byEnv.accountId;
      if (canonical !== undefined && canonical !== null && String(canonical)) {
        return String(canonical);
      }
    }
    return envId;
  }

  const tik = rows.find(isTikTokAccount);
  const id = tik?.id ?? tik?.account_id ?? tik?.accountId;
  if (id !== undefined && id !== null && String(id)) {
    return String(id);
  }
  throw new Error(
    "No TikTok account: set AUTOMATION_TIKTOK_ACCOUNT_ID (e.g. nextboyfriend_community) or connect TikTok in SocialAPI and ensure /accounts returns it.",
  );
}
