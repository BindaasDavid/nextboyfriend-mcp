import { config } from "dotenv";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { loadState, saveState } from "./state.js";

const require = createRequire(import.meta.url);
const FFMPEG_BIN = (require("ffmpeg-static") as string | null) ?? "ffmpeg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

config({ path: join(PROJECT_ROOT, ".env") });
config({ path: join(process.cwd(), ".env") });

const SOCAPI_KEY = (process.env.SOCAPI_KEY ?? process.env.SOCIAL_API_KEY ?? "").trim();
const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY ?? "").trim();
const HEYGEN_API_KEY = (process.env.HEYGEN_API_KEY ?? "").trim();
const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY ?? "").trim();

if (!SOCAPI_KEY) {
  console.error("SOCAPI_KEY or SOCIAL_API_KEY is required.");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required.");
  process.exit(1);
}

const SOCIAL_BASE = "https://api.social-api.ai/v1";

async function socialApi(path: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SOCAPI_KEY}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${SOCIAL_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`SocialAPI ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<unknown>;
}

async function claude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  return data.content?.[0]?.text ?? "";
}

function normalizePostsList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === "object" && "data" in raw) {
    const d = (raw as { data: unknown }).data;
    if (Array.isArray(d)) {
      return d;
    }
  }
  return raw === undefined ? [] : [raw];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

function parseTrendNewsRelated(item: Record<string, unknown>): string {
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

function resolveProjectPath(p: string): string {
  return isAbsolute(p) ? p : join(PROJECT_ROOT, p);
}

const xmlParser = new XMLParser({ ignoreAttributes: false, trimValues: true });

const server = new McpServer(
  {
    name: "nextboyfriend-mcp",
    version: "1.0.0",
  },
  {
    instructions:
      "Next Boyfriend MCP: WordPress articles, Google Trends, YouTube search Atom, Claude posting plans, Pollinations images, ElevenLabs voice, FFmpeg reel assembly, optional HeyGen, SocialAPI accounts/posts/usage/engagement.",
  },
);

server.tool(
  "fetch_articles",
  "Fetch new WordPress posts since last run (nextboyfriend.com)",
  { limit: z.number().default(10) },
  async ({ limit }) => {
    const state = loadState();
    const params = new URLSearchParams({
      per_page: String(limit),
      orderby: "date",
      order: "desc",
      after: state.last_fetched_at,
      _fields: "slug,link,title,excerpt,date",
    });
    const wpUrl = `https://nextboyfriend.com/wp-json/wp/v2/posts?${params}`;
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
        `WordPress REST did not return a JSON array. Preview: ${bodyText.slice(0, 120)}`,
      );
    }
    const newPosts = posts.filter((p) => !state.seen_slugs.includes(p.slug));
    const articles = newPosts.map((p) => ({
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

    const text = articles.length
      ? JSON.stringify(articles, null, 2)
      : "No new articles since last run.";
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "fetch_trends",
  "Google Trends daily RSS, filtered by Claude for dating/relationship relevance",
  { geo: z.string().default("US") },
  async ({ geo }) => {
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
      throw new Error(`Google Trends ${res.status}`);
    }
    const xml = await res.text();
    const feed = xmlParser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
    const items = feed?.rss?.channel?.item ?? [];
    const list = Array.isArray(items) ? items : [items];
    const top = list.slice(0, 30);
    const trends = top.map((item: Record<string, unknown>) => ({
      topic: String(item.title ?? ""),
      traffic: item["ht:approx_traffic"] ?? "",
      related: parseTrendNewsRelated(item),
    }));

    const filtered = await claude(
      "You are a content strategist for a women's relationship advice brand.",
      `From these trending topics (JSON), pick the top 5 most relevant to dating, relationships, self-worth, or women's empowerment. Return ONLY valid JSON (array of objects with topic, reason). Topics: ${JSON.stringify(trends)}`,
    );

    return { content: [{ type: "text", text: filtered }] };
  },
);

server.tool(
  "fetch_youtube_trends",
  "First 10 videos from YouTube search Atom feed",
  { query: z.string().default("relationship advice women") },
  async ({ query }) => {
    const url = `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; nextboyfriend-mcp/1.0; +https://nextboyfriend.com)",
        Accept: "application/atom+xml",
      },
    });
    if (!res.ok) {
      throw new Error(`YouTube feed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const xml = await res.text();
    const parsed = xmlParser.parse(xml) as { feed?: { entry?: unknown } };
    const entries = parsed?.feed?.entry ?? [];
    const entryList = Array.isArray(entries) ? entries : [entries];
    const videos = entryList.slice(0, 10).map((e: Record<string, unknown>) => {
      const linkVal = e.link;
      let urlStr = "";
      if (typeof linkVal === "string") {
        urlStr = linkVal;
      } else if (Array.isArray(linkVal)) {
        const alt = linkVal.find(
          (x) =>
            x &&
            typeof x === "object" &&
            String((x as Record<string, unknown>)["@_rel"] ?? "") === "alternate",
        ) as Record<string, unknown> | undefined;
        urlStr = String(
          alt?.["@_href"] ?? (linkVal[0] as Record<string, unknown> | undefined)?.["@_href"] ?? "",
        );
      } else if (linkVal && typeof linkVal === "object") {
        urlStr = String((linkVal as Record<string, unknown>)["@_href"] ?? "");
      }
      const mg = e["media:group"] as Record<string, unknown> | undefined;
      const comm = mg?.["media:community"] as Record<string, unknown> | undefined;
      const stats = comm?.["media:statistics"] as Record<string, unknown> | undefined;
      const views = stats?.["@_views"] ?? stats?.views ?? "";
      return {
        title: e.title ?? "",
        views,
        url: urlStr,
        published: e.published ?? "",
      };
    });
    return { content: [{ type: "text", text: JSON.stringify(videos, null, 2) }] };
  },
);

server.tool(
  "generate_posting_plan",
  "Claude-generated posting plan (JSON) with captions, hashtags, image_prompt, optional reel_script",
  {
    title: z.string(),
    excerpt: z.string(),
    url: z.string(),
    trending_angle: z.string().optional(),
    platforms: z
      .array(z.enum(["instagram", "facebook", "tiktok", "x"]))
      .default(["instagram", "facebook", "tiktok", "x"]),
    prefer_video: z.boolean().default(false),
  },
  async ({ title, excerpt, url, trending_angle, platforms, prefer_video }) => {
    const plan = await claude(
      `You are a social media content strategist for Next Boyfriend (nextboyfriend.com).
Brand voice: direct, warm, no-nonsense, empowering. Target: women navigating dating & relationships.
Return ONLY valid JSON matching this structure (omit reel_script if prefer_video is false):
{
  "instagram": { "caption": "", "hashtags": [], "format": "", "image_prompt": "", "reel_script"?: { "hook": "", "body": [], "cta": "" } },
  "facebook": { ... },
  "tiktok": { ... },
  "x": { ... }
}
Only include top-level keys for requested platforms.`,
      `Article title: ${title}
Excerpt: ${excerpt}
URL: ${url}
${trending_angle ? `Trending angle: ${trending_angle}` : ""}
Platforms: ${platforms.join(", ")}
prefer_video: ${prefer_video}

Produce the JSON plan with strong hooks and on-brand hashtags.`,
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(plan) as Record<string, unknown>;
    } catch {
      parsed = { error: "parse_failed", raw: plan };
    }
    parsed._meta = { title, url, generated_at: new Date().toISOString() };

    return { content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }] };
  },
);

server.tool(
  "generate_image_pollinations",
  "Pollinations.ai image URL (no API key)",
  {
    prompt: z.string(),
    format: z.enum(["square", "portrait", "landscape", "story"]).default("square"),
  },
  async ({ prompt, format }) => {
    const dims: Record<string, [number, number]> = {
      square: [1080, 1080],
      portrait: [1080, 1350],
      landscape: [1200, 630],
      story: [1080, 1920],
    };
    const [w, h] = dims[format];
    const encoded = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&nologo=true&model=flux&enhance=true`;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ image_url: imageUrl, width: w, height: h, prompt }),
        },
      ],
    };
  },
);

server.tool(
  "generate_voiceover",
  "ElevenLabs text-to-speech to MP3 on disk",
  {
    script: z.string().max(500),
    voice_id: z.string().default("21m00Tcm4TlvDq8ikWAM"),
    stability: z.number().default(0.5),
    similarity_boost: z.number().default(0.75),
  },
  async ({ script, voice_id, stability, similarity_boost }) => {
    if (!ELEVENLABS_API_KEY) {
      throw new Error("ELEVENLABS_API_KEY is not set.");
    }
    const outFile = resolveProjectPath(`voiceover_${Date.now()}.mp3`);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: script,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability, similarity_boost },
      }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(outFile, buf);
    const sizeKb = Math.round((buf.length / 1024) * 10) / 10;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            file: outFile,
            size_kb: sizeKb,
            next_step: "Use assemble_reel with this audio and an image, or upload the MP3 elsewhere.",
          }),
        },
      ],
    };
  },
);

server.tool(
  "assemble_reel",
  "FFmpeg: still image + audio → vertical MP4",
  {
    image_path: z.string(),
    audio_path: z.string(),
    output_path: z.string().default("reel_output.mp4"),
  },
  async ({ image_path, audio_path, output_path }) => {
    const image = resolveProjectPath(image_path);
    const audio = resolveProjectPath(audio_path);
    const output = resolveProjectPath(output_path);
    const vf =
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black";
    const cmd = [
      `"${FFMPEG_BIN}"`,
      "-y",
      "-loop",
      "1",
      "-i",
      `"${image}"`,
      "-i",
      `"${audio}"`,
      "-c:v",
      "libx264",
      "-tune",
      "stillimage",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-vf",
      `"${vf}"`,
      "-shortest",
      "-movflags",
      "+faststart",
      `"${output}"`,
    ].join(" ");
    execSync(cmd, { stdio: "inherit" });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            output,
            next_step: "Upload or publish the reel via your workflow.",
          }),
        },
      ],
    };
  },
);

server.tool(
  "create_heygen_reel",
  "HeyGen avatar video (requires HEYGEN_API_KEY)",
  {
    script: z.string().max(300),
    avatar_id: z.string().default("Daisy-inskirt-20220818"),
    voice_id: z.string().default("1bd001e7e50f421d891986aad5158bc8"),
    title: z.string(),
  },
  async ({ script, avatar_id, voice_id, title }) => {
    if (!HEYGEN_API_KEY) {
      throw new Error("HEYGEN_API_KEY is not set.");
    }
    const res = await fetch("https://api.heygen.com/v2/video/generate", {
      method: "POST",
      headers: { "X-Api-Key": HEYGEN_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        video_inputs: [
          {
            character: { type: "avatar", avatar_id, scale: 1 },
            voice: { type: "text", input_text: script, voice_id },
          },
        ],
        dimension: { width: 1080, height: 1920 },
        title,
      }),
    });
    if (!res.ok) {
      throw new Error(`HeyGen ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { data?: { video_id?: string } };
    const video_id = data.data?.video_id;
    const dashboard_url = video_id ? `https://app.heygen.com/videos/${video_id}` : "";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            video_id,
            status: "processing",
            dashboard_url,
          }),
        },
      ],
    };
  },
);

server.tool(
  "check_heygen_status",
  "HeyGen video status (raw API response)",
  { video_id: z.string() },
  async ({ video_id }) => {
    if (!HEYGEN_API_KEY) {
      throw new Error("HEYGEN_API_KEY is not set.");
    }
    const res = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(video_id)}`,
      { headers: { "X-Api-Key": HEYGEN_API_KEY } },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HeyGen ${res.status}: ${text}`);
    }
    return { content: [{ type: "text", text }] };
  },
);

server.tool(
  "list_accounts",
  "List SocialAPI connected accounts",
  {},
  async () => {
    const data = await socialApi("/accounts");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "create_post",
  "Create a post via SocialAPI",
  {
    account_ids: z.array(z.string()),
    text: z.string(),
    scheduled_at: z.string().optional(),
    media_urls: z.array(z.string()).optional(),
  },
  async ({ account_ids, text, scheduled_at, media_urls }) => {
    const body: Record<string, unknown> = {
      text,
      targets: account_ids.map((account_id) => ({ account_id })),
    };
    if (scheduled_at !== undefined) {
      body.scheduled_at = scheduled_at;
    }
    if (media_urls !== undefined) {
      body.media_urls = media_urls;
    }
    const data = await socialApi("/posts", "POST", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_engagement_report",
  "Published posts + Claude analysis (scores, patterns, recommendations)",
  { limit: z.number().default(25) },
  async ({ limit }) => {
    const postsRaw = await socialApi(`/posts?status=published&limit=${limit}`);
    const normalized = normalizePostsList(postsRaw);
    const scored = await claude(
      "You are a social media analyst for a women's relationship brand. Return ONLY valid JSON.",
      `Posts (normalized): ${JSON.stringify(normalized)}

Score each post 1-10, find top 3 patterns in high performers, recommend 3 content types to lean into.
Return JSON: { "scores": [{"post_id": "", "score": 0, "reason": ""}], "patterns": [], "recommendations": [] }`,
    );
    return { content: [{ type: "text", text: scored }] };
  },
);

server.tool(
  "get_usage",
  "SocialAPI usage",
  {},
  async () => {
    const data = await socialApi("/usage");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
