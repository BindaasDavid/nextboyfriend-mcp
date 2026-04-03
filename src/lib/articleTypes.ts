/** Normalized article for posting pipelines (Supabase CMS or WordPress REST). */
export interface HarvestedArticle {
  source_id: string;
  title: string;
  url: string;
  excerpt: string;
  published_at: string;
}
