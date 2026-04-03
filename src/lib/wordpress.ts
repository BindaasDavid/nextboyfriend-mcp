import { loadState, saveState } from "../state.js";
import { stripHtml } from "./text.js";

export interface HarvestedArticle {
  source_id: string;
  title: string;
  url: string;
  excerpt: string;
  published_at: string;
}

function wpBase(): string {
  return (process.env.WORDPRESS_API_BASE ?? "https://nextboyfriend.com").replace(/\/$/, "");
}

/**
 * Fetches new posts since last run, updates `.article-state.json`, returns new articles only.
 */
export async function harvestNewArticles(limit: number): Promise<HarvestedArticle[]> {
  const state = loadState();
  const params = new URLSearchParams({
    per_page: String(limit),
    orderby: "date",
    order: "desc",
    after: state.last_fetched_at,
    _fields: "slug,link,title,excerpt,date",
  });
  const wpUrl = `${wpBase()}/wp-json/wp/v2/posts?${params}`;
  const res = await fetch(wpUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "nextboyfriend-mcp/1.0 (+https://nextboyfriend.com)",
    },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`WP API ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  let posts: Array<{
    slug: string;
    link: string;
    title?: { rendered?: string };
    excerpt?: { rendered?: string };
    date: string;
  }>;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!Array.isArray(parsed)) {
      throw new Error("not_array");
    }
    posts = parsed as typeof posts;
  } catch {
    throw new Error(
      `WordPress REST did not return a JSON array. Set WORDPRESS_API_BASE if needed. Preview: ${bodyText.slice(0, 120)}`,
    );
  }
  const newPosts = posts.filter((p) => !state.seen_slugs.includes(p.slug));
  const articles: HarvestedArticle[] = newPosts.map((p) => ({
    source_id: p.slug,
    title: p.title?.rendered ?? "",
    url: p.link,
    excerpt: stripHtml(p.excerpt?.rendered ?? ""),
    published_at: p.date,
  }));

  saveState({
    last_fetched_at: new Date().toISOString(),
    seen_slugs: [...state.seen_slugs, ...articles.map((a) => a.source_id)],
  });

  return articles;
}
