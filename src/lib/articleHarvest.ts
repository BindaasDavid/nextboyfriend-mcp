import type { HarvestedArticle } from "./articleTypes.js";
import { harvestNewArticlesFromSupabase } from "./supabaseHarvest.js";
import { harvestNewArticles } from "./wordpress.js";

export type { HarvestedArticle } from "./articleTypes.js";

/**
 * `supabase` (default) — CMS rows from PostgREST `articles`.
 * `wordpress` — legacy WordPress `/wp-json/wp/v2/posts` (set `WORDPRESS_API_BASE` if needed).
 */
export async function harvestArticles(limit: number): Promise<HarvestedArticle[]> {
  const raw = (process.env.AUTOMATION_ARTICLE_SOURCE ?? process.env.ARTICLE_SOURCE ?? "supabase")
    .trim()
    .toLowerCase();
  if (raw === "wordpress" || raw === "wp") {
    return harvestNewArticles(limit);
  }
  return harvestNewArticlesFromSupabase(limit);
}
