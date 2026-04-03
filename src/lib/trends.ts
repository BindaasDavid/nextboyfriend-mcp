import { xmlParser } from "./xml.js";

export function parseTrendNewsRelated(item: Record<string, unknown>): string {
  const raw = item["ht:news_item"];
  if (raw === undefined || raw === null) {
    return "";
  }
  const items = Array.isArray(raw) ? raw : [raw];
  const titles: string[] = [];
  for (const n of items) {
    if (n && typeof n === "object") {
      const o = n as Record<string, unknown>;
      const t = o["ht:news_item_title"] ?? o.title;
      if (typeof t === "string" && t) {
        titles.push(t);
      }
    }
  }
  return titles.join(" | ");
}

/** Short snippet of trending topics for prompts (best-effort; fails soft). */
export async function fetchGoogleTrendsSnippet(geo: string, maxTopics: number): Promise<string> {
  try {
    const res = await fetch(
      `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${encodeURIComponent(geo)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; nextboyfriend-mcp/1.0; +https://nextboyfriend.com)",
        },
      },
    );
    if (!res.ok) {
      return "";
    }
    const xml = await res.text();
    const feed = xmlParser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
    const items = feed?.rss?.channel?.item ?? [];
    const list = Array.isArray(items) ? items : [items];
    const topics = list.slice(0, maxTopics).map((item: Record<string, unknown>) =>
      String(item.title ?? ""),
    );
    return topics.filter(Boolean).join("; ");
  } catch {
    return "";
  }
}
