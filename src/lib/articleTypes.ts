/** Normalized article for posting pipelines (Supabase `articles`). */
export interface HarvestedArticle {
  source_id: string;
  title: string;
  url: string;
  excerpt: string;
  published_at: string;
}
