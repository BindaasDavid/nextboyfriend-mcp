/**
 * Supabase PostgREST: list rows from `articles` for editorial review and tooling.
 * @see https://supabase.com/docs/guides/api
 */

const DEFAULT_SUPABASE_ORIGIN = "https://whkenlpvrcaztgmvkusa.supabase.co";

/** Ensures `https://` so `fetch()` gets a valid absolute URL (host-only env breaks undici). */
function normalizeHttpOrigin(raw: string, label: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error(`${label} must be a valid URL (e.g. https://xxxx.supabase.co). Got: ${raw.slice(0, 120)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return u.origin;
}

async function fetchSupabaseJson(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause =
      e instanceof Error && e.cause !== undefined
        ? ` [cause: ${e.cause instanceof Error ? e.cause.message : String(e.cause)}]`
        : "";
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      /* invalid url already surfaced elsewhere */
    }
    throw new Error(
      `Supabase fetch failed${host ? ` (${host})` : ""}: ${msg}${cause}. ` +
        `Check SUPABASE_URL (include https://), DNS/VPN, and that the project is reachable.`,
    );
  }
}

function requireSupabaseKey(): string {
  const key =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    (process.env.SUPABASE_ANON_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "Set SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY for Supabase REST access.",
    );
  }
  return key;
}

/** Full REST URL to the articles table (default matches project instructions). */
export function supabaseArticlesRestUrl(): string {
  const explicit = (process.env.SUPABASE_ARTICLES_REST_URL ?? "").trim();
  if (explicit) {
    const trimmed = explicit.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let u: URL;
    try {
      u = new URL(withScheme);
    } catch {
      throw new Error(
        `SUPABASE_ARTICLES_REST_URL must be a valid URL. Got: ${explicit.slice(0, 120)}`,
      );
    }
    let path = u.pathname.replace(/\/$/, "") || "";
    if (!path || path === "/") {
      path = "/rest/v1/articles";
    }
    return `${u.origin}${path}${u.search}`;
  }
  const origin = normalizeHttpOrigin(
    process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_ORIGIN,
    "SUPABASE_URL",
  );
  return `${origin}/rest/v1/articles`;
}

export interface ListSupabaseArticlesOptions {
  /** PostgREST select fragment, default * */
  select?: string;
  /** PostgREST filters, e.g. "is_published=eq.true" */
  filter?: string;
  /** PostgREST order, e.g. "created_at.desc" */
  order?: string;
  /** Max rows to return across all pages (safety cap). */
  maxRows: number;
  /** Rows per HTTP request (PostgREST Range). */
  pageSize: number;
}

/**
 * Paginates through GET …/articles until all rows are fetched or maxRows reached.
 */
export async function listAllSupabaseArticles(
  options: ListSupabaseArticlesOptions,
): Promise<{ rows: unknown[]; truncated: boolean; totalFetched: number }> {
  const key = requireSupabaseKey();
  const baseUrl = supabaseArticlesRestUrl();
  const select = (options.select ?? "*").trim() || "*";
  const filter = (options.filter ?? "").trim();
  const order = (options.order ?? "").trim();
  const pageSize = Math.min(1000, Math.max(1, options.pageSize));
  const maxRows = Math.max(1, options.maxRows);

  const queryParts = [`select=${encodeURIComponent(select)}`];
  if (filter) {
    queryParts.push(filter);
  }
  if (order) {
    queryParts.push(`order=${encodeURIComponent(order)}`);
  }
  const qs = queryParts.join("&");
  const url = baseUrl.includes("?") ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`;

  const rows: unknown[] = [];
  let start = 0;
  let truncated = false;

  while (rows.length < maxRows) {
    const end = start + pageSize - 1;
    const res = await fetchSupabaseJson(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        Range: `${start}-${end}`,
        Prefer: "count=exact",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Supabase REST ${res.status}: ${text.slice(0, 800)}`);
    }

    let batch: unknown[];
    try {
      const parsed: unknown = JSON.parse(text);
      batch = Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Error(`Supabase REST did not return JSON array: ${text.slice(0, 200)}`);
    }

    const remaining = maxRows - rows.length;
    if (batch.length > remaining) {
      rows.push(...batch.slice(0, remaining));
      truncated = true;
      break;
    }
    rows.push(...batch);

    if (batch.length < pageSize) {
      break;
    }

    const contentRange = res.headers.get("content-range");
    if (contentRange) {
      const m = contentRange.match(/\/(\d+|\*)\s*$/);
      const total = m && m[1] !== "*" ? Number(m[1]) : null;
      if (total !== null && start + batch.length >= total) {
        break;
      }
    }

    start += pageSize;
    if (batch.length === 0) {
      break;
    }
  }

  return { rows, truncated, totalFetched: rows.length };
}
