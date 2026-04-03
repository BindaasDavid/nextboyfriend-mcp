import { loadState, saveState } from "../state.js";
import type { HarvestedArticle } from "./articleTypes.js";
import { listAllSupabaseArticles } from "./supabaseArticles.js";
import { stripHtml } from "./text.js";

/** Matches Next Boyfriend CMS columns (override via SUPABASE_ARTICLES_* env). */
const DEFAULT_SELECT =
  "id,title,slug,category,created_at,source_url,source_name,excerpt";
const DEFAULT_FILTER = "is_published=eq.true";
const DEFAULT_ORDER = "created_at.desc";

function rowToArticle(row: Record<string, unknown>): HarvestedArticle | null {
  const id = row.id ?? row.slug;
  if (id === undefined || id === null || String(id).trim() === "") {
    return null;
  }
  const title = String(row.title ?? row.headline ?? row.name ?? "").trim();
  const url = String(
    row.source_url ?? row.url ?? row.link ?? row.canonical_url ?? "",
  ).trim();
  const excerpt = stripHtml(
    String(row.excerpt ?? row.summary ?? row.description ?? row.body ?? row.body_html ?? ""),
  );
  const published = String(
    row.created_at ?? row.published_at ?? row.updated_at ?? new Date().toISOString(),
  );
  return {
    source_id: String(id),
    title,
    url,
    excerpt: excerpt.slice(0, 4000),
    published_at: published,
  };
}

/**
 * New articles from Supabase `articles` table since last run (dedupe via `.article-state.json` `seen_slugs`).
 */
export async function harvestNewArticlesFromSupabase(limit: number): Promise<HarvestedArticle[]> {
  const state = loadState();
  const select = (process.env.SUPABASE_ARTICLES_SELECT ?? "").trim() || DEFAULT_SELECT;
  const filter = (process.env.SUPABASE_ARTICLES_FILTER ?? "").trim() || DEFAULT_FILTER;
  const order = (process.env.SUPABASE_ARTICLES_ORDER ?? "").trim() || DEFAULT_ORDER;
  const scanCap = Math.min(5000, Math.max(200, limit * 80));

  const { rows } = await listAllSupabaseArticles({
    maxRows: scanCap,
    pageSize: 500,
    select,
    filter,
    order,
  });

  const mapped: HarvestedArticle[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") {
      continue;
    }
    const a = rowToArticle(r as Record<string, unknown>);
    if (a) {
      mapped.push(a);
    }
  }

  mapped.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

  const newOnes = mapped.filter((a) => !state.seen_slugs.includes(a.source_id)).slice(0, limit);

  saveState({
    last_fetched_at: new Date().toISOString(),
    seen_slugs: [...state.seen_slugs, ...newOnes.map((x) => x.source_id)],
  });

  return newOnes;
}
