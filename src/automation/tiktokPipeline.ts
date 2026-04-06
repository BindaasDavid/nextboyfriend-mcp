import { harvestArticles } from "../lib/articleHarvest.js";
import type { HarvestedArticle } from "../lib/articleTypes.js";
import { notifyAnthropicCreditsDepleted } from "../lib/automationNotify.js";
import { claude, isAnthropicInsufficientCreditError } from "../lib/claude.js";
import {
  generateHeygenAvatarVideo,
  truncateHeygenScript,
  waitForHeygenVideoComplete,
} from "../lib/heygen.js";
import { buildPollinationsImageUrl, type PollinationsFormat } from "../lib/pollinations.js";
import {
  socialApi,
  uploadHeygenMp4ToSocial,
  uploadMediaFromPollinationsUrl,
} from "../lib/social.js";
import { fetchGoogleTrendsSnippet } from "../lib/trends.js";
import { parseJsonObject } from "./json.js";
import { resolvePlatformAccount } from "./tiktokAccounts.js";

const CHANNEL_ORDER = ["tiktok", "instagram", "facebook", "x"] as const;
type Channel = (typeof CHANNEL_ORDER)[number];

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

/** Parse comma-separated list; default `tiktok` only. */
export function parseAutomationChannels(): Channel[] {
  const raw = (process.env.AUTOMATION_CHANNELS ?? "tiktok").trim().toLowerCase();
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (p === "twitter" ? "x" : p));
  const allowed = new Set<string>(CHANNEL_ORDER);
  const out = parts.filter((p) => allowed.has(p)) as Channel[];
  return out.length ? out : ["tiktok"];
}

function validateAutomationEnv(templateCopy: boolean, channels: Channel[], includeMedia: boolean): void {
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
  if (includeMedia && channels.includes("tiktok") && !(process.env.HEYGEN_API_KEY ?? "").trim()) {
    throw new Error(
      "[automation] TikTok video requires HEYGEN_API_KEY (all TikTok media uses HeyGen). " +
        "Set AUTOMATION_INCLUDE_MEDIA_URLS=false for text-only TikTok, or add HEYGEN_API_KEY.",
    );
  }
}

const DEFAULT_AUTOMATION_MODEL = "claude-haiku-4-5-20251001";

function resolveAutomationAnthropicModel(): string {
  return (
    (process.env.AUTOMATION_ANTHROPIC_MODEL ?? "").trim() ||
    (process.env.ANTHROPIC_MODEL ?? "").trim() ||
    DEFAULT_AUTOMATION_MODEL
  );
}

function schemaLinesForChannels(channels: Channel[]): string {
  const lines: string[] = [];
  if (channels.includes("tiktok")) {
    lines.push(
      `"tiktok": {
  "caption": "on-screen / description, under 2200 chars",
  "hashtags": ["tag1", "tag2", "up to 8, no # prefix"],
  "avatar_script": "spoken only; max 300 chars; human, friend-to-friend; no influencer clichés; no hashtags in script"
}`,
    );
  }
  if (channels.includes("instagram")) {
    lines.push(
      `"instagram": {
  "caption": "feed caption; line breaks ok",
  "hashtags": ["up to 15 tags"],
  "image_prompt": "Pollinations prompt: vertical or square aesthetic, no text in image",
  "pollinations_format": "square" | "portrait" | "story"
}`,
    );
  }
  if (channels.includes("facebook")) {
    lines.push(
      `"facebook": {
  "caption": "longer post body; engaging first line",
  "hashtags": ["optional", "fewer"],
  "image_prompt": "Pollinations prompt: landscape or square for link-style share",
  "pollinations_format": "landscape" | "square"
}`,
    );
  }
  if (channels.includes("x")) {
    lines.push(
      `"x": {
  "text": "single post under 280 chars; include 1-2 hashtags inline if space"
}`,
    );
  }
  return lines.join(",\n");
}

function templateRepurpose(article: HarvestedArticle, channels: Channel[]): Record<string, unknown> {
  const excerpt = article.excerpt?.trim() || article.title;
  const cap = excerpt.length > 2100 ? `${excerpt.slice(0, 2097)}…` : excerpt;
  const script = article.excerpt?.trim().slice(0, 300) || article.title.slice(0, 300);
  const out: Record<string, unknown> = {};
  const tags = ["relationships", "healing", "selfworth", "dating", "mentalhealth"];
  if (channels.includes("tiktok")) {
    out.tiktok = { caption: cap, hashtags: tags, avatar_script: script };
  }
  if (channels.includes("instagram")) {
    out.instagram = {
      caption: cap.slice(0, 2200),
      hashtags: tags,
      image_prompt: `Editorial portrait, warm light, empowering, woman-centered: ${article.title}`,
      pollinations_format: "square",
    };
  }
  if (channels.includes("facebook")) {
    out.facebook = {
      caption: cap.slice(0, 5000),
      hashtags: tags.slice(0, 3),
      image_prompt: `Warm editorial scene, community, empowerment: ${article.title}`,
      pollinations_format: "landscape",
    };
  }
  if (channels.includes("x")) {
    const t = excerpt.length > 270 ? `${excerpt.slice(0, 267)}…` : excerpt;
    out.x = { text: `${t} #relationships` };
  }
  return out;
}

function asPollinationsFormat(s: unknown): PollinationsFormat {
  const v = String(s ?? "square").toLowerCase();
  if (v === "square" || v === "portrait" || v === "landscape" || v === "story") {
    return v;
  }
  return "square";
}

function pickRepurposeBlock(
  plan: Record<string, unknown>,
  article: HarvestedArticle,
  channel: Channel,
): Record<string, unknown> {
  const raw = plan[channel];
  if (raw && typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  if (channel === "tiktok" && plan.caption !== undefined) {
    return {
      caption: plan.caption,
      hashtags: plan.hashtags ?? [],
      avatar_script: plan.avatar_script ?? plan.caption,
    };
  }
  return templateRepurpose(article, [channel])[channel] as Record<string, unknown>;
}

/**
 * Harvest → Claude repurposing (per channel) → TikTok always HeyGen video; other channels Pollinations + text.
 */
export async function runTikTokAutomation(): Promise<void> {
  const templateCopy = envFlagTrue("AUTOMATION_TEMPLATE_COPY");
  const channels = parseAutomationChannels();

  const dryRun =
    String(process.env.AUTOMATION_DRY_RUN ?? "").toLowerCase() === "true" ||
    String(process.env.AUTOMATION_DRY_RUN ?? "") === "1";

  const limit = Math.min(15, Math.max(1, Number(process.env.AUTOMATION_HARVEST_LIMIT ?? "8") || 8));
  const geo = (process.env.AUTOMATION_TRENDS_GEO ?? "US").trim();

  const includeMediaUrls = !["0", "false", "no"].includes(
    String(process.env.AUTOMATION_INCLUDE_MEDIA_URLS ?? "true").toLowerCase(),
  );

  validateAutomationEnv(templateCopy, channels, includeMediaUrls);

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
  console.log(`[automation] Channels: ${channels.join(", ")} (set AUTOMATION_CHANNELS, e.g. tiktok,instagram)`);

  let trendLine = "";
  try {
    trendLine = await fetchGoogleTrendsSnippet(geo, 8);
    if (trendLine) {
      console.log(`[automation] Trends snippet: ${trendLine.slice(0, 120)}…`);
    }
  } catch {
    /* soft */
  }

  let plan: Record<string, unknown> | undefined;
  if (templateCopy) {
    console.log("[automation] AUTOMATION_TEMPLATE_COPY — template text per channel.");
    plan = templateRepurpose(article, channels);
  } else {
    const userPrompt = `You repurpose one article into channel-specific social posts for Next Boyfriend (women, dating & relationships).

Article title: ${article.title}
Article excerpt: ${article.excerpt}
Article URL: ${article.url}
${trendLine ? `Current trending context (Google Trends, ${geo}): ${trendLine}` : ""}

Return ONLY valid JSON (no markdown) with exactly these top-level keys: ${channels.map((c) => `"${c}"`).join(", ")}
Shape per channel:
${schemaLinesForChannels(channels)}

TikTok: avatar_script is the ONLY text spoken by the HeyGen avatar (TTS), max 300 chars. Write like a real person talking to a friend: conversational, warm, one idea. No "in this video", "unlock", "game-changer", "here's the thing", or generic influencer tone. No hashtags or emoji in avatar_script.
Other channels: use distinct hooks and lengths appropriate to each platform (Instagram = visual + hashtags; Facebook = longer; X = concise).`;

    const automationModel = resolveAutomationAnthropicModel();
    console.log(`[automation] Generating repurposed copy with Claude (model: ${automationModel})…`);
    let raw: string | undefined;
    try {
      raw = await claude(
        "You are a viral dating-and-relationship content strategist. Output JSON only. Never fake statistics.",
        userPrompt,
        { model: automationModel },
      );
    } catch (e) {
      if (!isAnthropicInsufficientCreditError(e)) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[automation] Anthropic credits exhausted — using template copy per channel.");
      await notifyAnthropicCreditsDepleted({ articleTitle: article.title, errorSnippet: msg });
      plan = templateRepurpose(article, channels);
    }
    if (raw !== undefined) {
      try {
        plan = parseJsonObject(raw);
      } catch (e) {
        console.error("[automation] Claude did not return parseable JSON:", raw.slice(0, 500));
        throw e;
      }
    }
    if (plan === undefined) {
      plan = templateRepurpose(article, channels);
    }
  }

  const ordered = CHANNEL_ORDER.filter((c) => channels.includes(c));

  for (const channel of ordered) {
    const block = pickRepurposeBlock(plan, article, channel);
    await postOneChannel({
      channel,
      block,
      article,
      dryRun,
      includeMediaUrls,
    });
  }
}

type PostOneArgs = {
  channel: Channel;
  block: Record<string, unknown>;
  article: HarvestedArticle;
  dryRun: boolean;
  includeMediaUrls: boolean;
};

async function postOneChannel(args: PostOneArgs): Promise<void> {
  const { channel, block, article, dryRun, includeMediaUrls } = args;

  let text = "";
  if (channel === "x") {
    text = String(block.text ?? "").trim();
  } else {
    const cap = String(block.caption ?? "");
    const hashtagsRaw = block.hashtags;
    const hashtags = Array.isArray(hashtagsRaw)
      ? hashtagsRaw.map((h) => String(h)).filter(Boolean)
      : [];
    text = buildPostText(cap, hashtags);
  }

  if (!text && channel !== "tiktok") {
    console.warn(`[automation] Skipping ${channel}: empty text.`);
    return;
  }

  const accountId = await resolvePlatformAccount(channel);
  const body: Record<string, unknown> = {
    text: text || String(block.caption ?? ""),
    targets: [{ account_id: accountId }],
  };
  if (!dryRun) {
    body.publish_now = true;
  }

  if (includeMediaUrls) {
    if (channel === "tiktok") {
      const script = truncateHeygenScript(
        String(block.avatar_script ?? block.caption ?? ""),
      );
      if (!dryRun && !script.trim()) {
        throw new Error("[automation] TikTok: avatar_script is empty for HeyGen.");
      }
      if (dryRun) {
        console.log(
          `[automation] AUTOMATION_DRY_RUN [${channel}] — HeyGen avatar (script ${script.length} chars) → MP4 → SocialAPI media_ids`,
        );
      } else {
        console.log(
          `[automation] [${channel}] HeyGen avatar video (script ${script.length} chars)…`,
        );
        const videoId = await generateHeygenAvatarVideo({
          script,
          title: article.title.slice(0, 120),
        });
        console.log(`[automation] HeyGen job ${videoId} — waiting for render…`);
        const mp4Url = await waitForHeygenVideoComplete(videoId);
        console.log("[automation] Uploading HeyGen MP4 to SocialAPI…");
        const mediaId = await uploadHeygenMp4ToSocial(mp4Url, `tiktok-${channel}.mp4`);
        body.media_ids = [mediaId];
      }
    } else if (channel === "instagram" || channel === "facebook") {
      const prompt = String(block.image_prompt ?? article.title);
      const fmt = asPollinationsFormat(block.pollinations_format);
      const { image_url: imageUrl } = buildPollinationsImageUrl(prompt, fmt);
      if (dryRun) {
        console.log(
          `[automation] AUTOMATION_DRY_RUN [${channel}] — Pollinations (${fmt}) → POST /v1/media/upload:`,
          imageUrl.slice(0, 100) + "…",
        );
      } else {
        console.log(`[automation] [${channel}] Uploading Pollinations image (${fmt})…`);
        const mediaId = await uploadMediaFromPollinationsUrl(imageUrl);
        body.media_ids = [mediaId];
      }
    }
  }

  if (dryRun) {
    console.log(`[automation] AUTOMATION_DRY_RUN [${channel}] — would POST /posts:`, JSON.stringify(body, null, 2));
    return;
  }

  console.log(`[automation] Posting to ${channel} via SocialAPI…`);
  const result = await socialApi("/posts", "POST", body);
  console.log(`[automation] Success [${channel}]:`, JSON.stringify(result, null, 2));
}
