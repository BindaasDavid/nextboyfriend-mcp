import { socialApi } from "../lib/social.js";

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

/** Env var per SocialAPI platform for `POST /posts` targets. */
export const PLATFORM_ACCOUNT_ENV: Record<string, string> = {
  tiktok: "AUTOMATION_TIKTOK_ACCOUNT_ID",
  instagram: "AUTOMATION_INSTAGRAM_ACCOUNT_ID",
  facebook: "AUTOMATION_FACEBOOK_ACCOUNT_ID",
  x: "AUTOMATION_X_ACCOUNT_ID",
};

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

export function isPlatformAccount(row: Record<string, unknown>, platform: string): boolean {
  const p = String(row.platform ?? row.provider ?? row.network ?? row.type ?? row.channel ?? "").toLowerCase();
  const n = String(row.name ?? row.username ?? row.handle ?? "").toLowerCase();
  if (platform === "x") {
    return p.includes("twitter") || p === "x" || n.includes("twitter");
  }
  return p.includes(platform) || n.includes(platform);
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
 * Resolve connected account id for SocialAPI (`tiktok` | `instagram` | `facebook` | `x`).
 * Uses `AUTOMATION_<PLATFORM>_ACCOUNT_ID` or first matching account from GET /accounts.
 */
export async function resolvePlatformAccount(platform: string): Promise<string> {
  const envKey = PLATFORM_ACCOUNT_ENV[platform];
  if (!envKey) {
    throw new Error(`Unknown platform: ${platform}. Expected one of: ${Object.keys(PLATFORM_ACCOUNT_ENV).join(", ")}`);
  }
  const envId = (process.env[envKey] ?? "").trim();
  const raw = await socialApi("/accounts");
  const rows = listAccountsFromResponse(raw);
  const platformRows = rows.filter((r) => isPlatformAccount(r, platform));

  if (envId) {
    const want = normalizeHandle(envId);
    const byEnv =
      platformRows.find((r) => rowMatchesEnvId(r, want)) ??
      rows.find((r) => rowMatchesEnvId(r, want));
    if (byEnv) {
      const canonical = byEnv.id ?? byEnv.account_id ?? byEnv.accountId;
      if (canonical !== undefined && canonical !== null && String(canonical)) {
        return String(canonical);
      }
    }
    if (rows.length > 0) {
      const summary = summarizeAccountsForError(platformRows.length ? platformRows : rows);
      throw new Error(
        `${envKey}="${envId}" did not match a ${platform} account from GET /accounts.\n${summary}`,
      );
    }
    console.warn(
      `[automation] GET /accounts returned 0 rows; posting with ${envKey} as-is (${envId}). If POST fails with account_not_found, set the internal id from SocialAPI.`,
    );
    return envId;
  }

  const first = platformRows[0] ?? rows.find((r) => isPlatformAccount(r, platform));
  const id = first?.id ?? first?.account_id ?? first?.accountId;
  if (id !== undefined && id !== null && String(id)) {
    return String(id);
  }
  throw new Error(
    rows.length > 0
      ? `No ${platform} account in SocialAPI response. Accounts:\n${summarizeAccountsForError(rows)}`
      : `No ${platform} account: GET /accounts returned no rows. Connect the account in SocialAPI or set ${envKey}.`,
  );
}

/** @deprecated Use resolvePlatformAccount("tiktok") */
export async function resolveTikTokAccountId(): Promise<string> {
  return resolvePlatformAccount("tiktok");
}
