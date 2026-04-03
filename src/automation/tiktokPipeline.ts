import { harvestArticles } from "../lib/articleHarvest.js";
import type { HarvestedArticle } from "../lib/articleTypes.js";
import { notifyAnthropicCreditsDepleted } from "../lib/automationNotify.js";
import { claude, isAnthropicInsufficientCreditError } from "../lib/claude.js";
import { buildPollinationsImageUrl } from "../lib/pollinations.js";
import { socialApi } from "../lib/social.js";
import { fetchGoogleTrendsSnippet } from "../lib/trends.js";
import { parseJsonObject } from "./json.js";
import { resolveTikTokAccountId } from "./tiktokAccounts.js";

function pickArticle(articles: HarvestedArticle[]): HarvestedArticle {
  const seed = process.env.AUTOMATION_CONTENT_SEED;
  if (seed) {
    const h = hashString(seed + articles.map((a) => a.source_id).join(","));
    return articles[h % articles.length]!;
  }
  return articles[0]!;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function buildPostText(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  return tags ? `${caption.trim()}\n\n${tags}` : caption.trim();
}

function envFlagTrue(name: string): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function validateAutomationEnv(templateCopy: boolean): void {
  const missing: string[] = [];
  if (!(process.env.SOCAPI_KEY ?? process.env.SOCIAL_API_KEY ?? "").trim()) {
    missing.push("SOCAPI_KEY or SOCIAL_API_KEY");
  }
  if (!templateCopy && !(process.env.ANTHROPIC_API_KEY ?? "").trim()) {
    missing.push("ANTHROPIC_API_KEY");
  }
  if (!(process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()) {
    missing.push("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (missing.length) {
    throw new Error(
      `[automation] Missing required secrets: ${missing.join(", ")}. ` +
        `Add them in GitHub → Settings → Secrets and variables → Actions (repository secrets).`,
    );
  }
}

const DEFAULT_AUTOMATION_MODEL = "claude-3-5-haiku-20241022";

/**
 * TikTok cron uses Haiku by default (cheap, enough for JSON captions).
 * Override: `AUTOMATION_ANTHROPIC_MODEL` → else `ANTHROPIC_MODEL` → else Haiku.
 */
function resolveAutomationAnthropicModel(): string {
  return (
    (process.env.AUTOMATION_ANTHROPIC_MODEL ?? "").trim() ||
    (process.env.ANTHROPIC_MODEL ?? "").trim() ||
    DEFAULT_AUTOMATION_MODEL
  );
}

/** When Claude is unavailable (e.g. no API credits), build minimal TikTok fields from the article. */
function templateTikTokPlan(article: HarvestedArticle): Record<string, unknown> {
  const excerpt = article.excerpt?.trim() || article.title;
  const caption =
    excerpt.length > 2100 ? `${excerpt.slice(0, 2097)}…` : excerpt;
  return {
    caption,
    hashtags: [
      "relationships",
      "healing",
      "selfworth",
      "dating",
      "mentalhealth",
    ],
    image_prompt: `Editorial portrait, warm light, empowering mood, woman-centered, soft focus background, no text: ${article.title}`,
  };
}

/**
 * GitHub Actions / cron: harvest → trends snippet → Claude (TikTok JSON) → Pollinations image → SocialAPI post (TikTok only).
 */
export async function runTikTokAutomation(): Promise<void> {
  const templateCopy = envFlagTrue("AUTOMATION_TEMPLATE_COPY");
  validateAutomationEnv(templateCopy);

  const dryRun =
    String(process.env.AUTOMATION_DRY_RUN ?? "").toLowerCase() === "true" ||
    String(process.env.AUTOMATION_DRY_RUN ?? "") === "1";

  const limit = Math.min(15, Math.max(1, Number(process.env.AUTOMATION_HARVEST_LIMIT ?? "8") || 8));
  const geo = (process.env.AUTOMATION_TRENDS_GEO ?? "US").trim();

  const includeMediaUrls = !["0", "false", "no"].includes(
    String(process.env.AUTOMATION_INCLUDE_MEDIA_URLS ?? "true").toLowerCase(),
  );

  console.log("[automation] Harvesting articles (Supabase)…");
  let articles: HarvestedArticle[];
  try {
    articles = await harvestArticles(limit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${msg}\n[automation] Supabase: set SUPABASE_ANON_KEY (or SERVICE_ROLE), SUPABASE_URL if needed, and check RLS allows read on articles.`,
    );
  }
  if (articles.length === 0) {
    console.log("[automation] No new articles since last run — nothing to post.");
    return;
  }

  const article = pickArticle(articles);
  console.log(`[automation] Using article: ${article.title} (${article.source_id})`);

  let trendLine = "";
  try {
    trendLine = await fetchGoogleTrendsSnippet(geo, 8);
    if (trendLine) {
      console.log(`[automation] Trends snippet: ${trendLine.slice(0, 120)}…`);
    }
  } catch {
    /* soft */
  }

  let plan: Record<string, unknown>;
  if (templateCopy) {
    console.log(
      "[automation] AUTOMATION_TEMPLATE_COPY — skipping Claude (caption/hashtags from article; add Anthropic credits for AI copy)",
    );
    plan = templateTikTokPlan(article);
  } else {
    const userPrompt = `You create viral TikTok captions for women-focused relationship advice.

Article title: ${article.title}
Article excerpt: ${article.excerpt}
Article URL: ${article.url}
${trendLine ? `Current trending context (Google Trends, ${geo}): ${trendLine}` : ""}

Return ONLY valid JSON (no markdown) with this shape:
{
  "caption": "Main caption, hook in first line, under 2200 chars, no URL spam",
  "hashtags": ["tag1", "tag2", "up to 8 tags, no # prefix in strings"],
  "image_prompt": "Detailed Pollinations prompt: stylish, empowering, woman-centered aesthetic, no text in image, vertical social feel"
}`;

    const automationModel = resolveAutomationAnthropicModel();
    console.log(
      `[automation] Generating TikTok copy with Claude (model: ${automationModel})…`,
    );
    let fromClaude: Record<string, unknown> | undefined;
    let raw: string | undefined;
    try {
      raw = await claude(
        "You are a viral dating-and-relationship content creator for women. Be warm, direct, never fake statistics. Output JSON only.",
        userPrompt,
        { model: automationModel },
      );
    } catch (e) {
      if (!isAnthropicInsufficientCreditError(e)) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        "[automation] Anthropic credits exhausted — using template copy (excerpt + default hashtags).",
      );
      await notifyAnthropicCreditsDepleted({
        articleTitle: article.title,
        errorSnippet: msg,
      });
      fromClaude = templateTikTokPlan(article);
    }
    if (raw !== undefined) {
      try {
        fromClaude = parseJsonObject(raw);
      } catch (e) {
        console.error("[automation] Claude did not return parseable JSON:", raw.slice(0, 500));
        throw e;
      }
    }
    if (fromClaude === undefined) {
      throw new Error("[automation] internal: no TikTok plan after Claude");
    }
    plan = fromClaude;
  }

  const caption = String(plan.caption ?? "");
  const hashtagsRaw = plan.hashtags;
  const hashtags = Array.isArray(hashtagsRaw)
    ? hashtagsRaw.map((h) => String(h)).filter(Boolean)
    : [];
  const imagePrompt = String(plan.image_prompt ?? article.title);

  if (!caption) {
    throw new Error("Claude JSON missing caption");
  }

  const { image_url: imageUrl } = buildPollinationsImageUrl(imagePrompt, "story");
  const postText = buildPostText(caption, hashtags);

  const accountId = await resolveTikTokAccountId();
  const body: Record<string, unknown> = {
    text: postText,
    targets: [{ account_id: accountId }],
  };
  if (includeMediaUrls) {
    body.media_urls = [imageUrl];
  }

  if (dryRun) {
    console.log("[automation] AUTOMATION_DRY_RUN — would POST /posts:", JSON.stringify(body, null, 2));
    return;
  }

  console.log("[automation] Posting to TikTok via SocialAPI…");
  const result = await socialApi("/posts", "POST", body);
  console.log("[automation] Success:", JSON.stringify(result, null, 2));
}
