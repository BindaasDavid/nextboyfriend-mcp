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
  for (const key of ["data", "accounts", "results", "items"] as const) {
    const arr = top[key];
    if (Array.isArray(arr)) {
      return arr.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    }
  }
  return [];
}

function isTikTokAccount(row: Record<string, unknown>): boolean {
  const p = String(row.platform ?? row.provider ?? row.network ?? row.type ?? row.channel ?? "").toLowerCase();
  const n = String(row.name ?? row.username ?? row.handle ?? "").toLowerCase();
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
  return ids.some((id) => id === envNormalized || id.endsWith(envNormalized) || envNormalized.endsWith(id));
}

function summarizeAccountsForError(rows: Record<string, unknown>[]): string {
  const lines = rows.slice(0, 12).map((r) => {
    const id = r.id ?? r.account_id ?? r.accountId ?? "?";
    const platform = r.platform ?? r.provider ?? r.type ?? "?";
    const label = r.username ?? r.name ?? r.handle ?? "";
    return `  - id=${String(id)} platform=${String(platform)} ${label ? `(${String(label)})` : ""}`;
  });
  const more = rows.length > 12 ? `\n  … and ${rows.length - 12} more` : "";
  return lines.join("\n") + more;
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
    const byEnv =
      tikTokRows.find((r) => rowMatchesEnvId(r, want)) ??
      rows.find((r) => rowMatchesEnvId(r, want));
    if (byEnv) {
      const canonical = byEnv.id ?? byEnv.account_id ?? byEnv.accountId;
      if (canonical !== undefined && canonical !== null && String(canonical)) {
        return String(canonical);
      }
    }
    /** Handles / usernames are not always valid `account_id` for POST /posts — need internal id from /accounts. */
    if (rows.length > 0) {
      const tikTokSummary = summarizeAccountsForError(tikTokRows.length ? tikTokRows : rows);
      throw new Error(
        `AUTOMATION_TIKTOK_ACCOUNT_ID="${envId}" did not match a TikTok account from SocialAPI GET /accounts.\n` +
          `Use the exact internal id from the list below (or fix the handle). Connected accounts:\n${tikTokSummary}\n` +
          `In GitHub: Settings → Secrets → AUTOMATION_TIKTOK_ACCOUNT_ID. In SocialAPI dashboard, confirm TikTok is connected.`,
      );
    }
    console.warn(
      `[automation] GET /accounts returned 0 rows; posting with AUTOMATION_TIKTOK_ACCOUNT_ID as-is (${envId}). If POST fails with account_not_found, set the internal id from SocialAPI.`,
    );
    return envId;
  }

  const tik = rows.find(isTikTokAccount);
  const id = tik?.id ?? tik?.account_id ?? tik?.accountId;
  if (id !== undefined && id !== null && String(id)) {
    return String(id);
  }
  throw new Error(
    rows.length > 0
      ? `No TikTok account in SocialAPI response. Accounts returned:\n${summarizeAccountsForError(rows)}\n` +
          `Connect TikTok in SocialAPI or set AUTOMATION_TIKTOK_ACCOUNT_ID to an id from the list.`
      : "No TikTok account: GET /accounts returned no rows. Check SOCAPI_KEY and SocialAPI dashboard (connect TikTok).",
  );
}
