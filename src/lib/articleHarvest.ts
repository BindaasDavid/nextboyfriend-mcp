import type { HarvestedArticle } from "./articleTypes.js";
import { harvestNewArticlesFromSupabase } from "./supabaseHarvest.js";

export type { HarvestedArticle } from "./articleTypes.js";

/** CMS rows from Supabase `articles` only. */
export function harvestArticles(limit: number): Promise<HarvestedArticle[]> {
  return harvestNewArticlesFromSupabase(limit);
}
