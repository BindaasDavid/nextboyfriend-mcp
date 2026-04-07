/**
 * HeyGen avatar video (v2 generate + v1 status poll).
 * @see https://docs.heygen.com/
 */

const DEFAULT_AVATAR_ID = "Daisy-inskirt-20220818";
const DEFAULT_VOICE_ID = "1bd001e7e50f421d891986aad5158bc8";
/** Default 9:16 — modest resolution so HeyGen output + re-encode stay under SocialAPI upload limits */
const DEFAULT_DIMENSION = { width: 540, height: 960 };
/** HeyGen text-to-speech input limit — keep under API caps */
const MAX_SCRIPT_CHARS = 300;

function heygenOutputDimension(): { width: number; height: number } {
  const w = Number((process.env.AUTOMATION_HEYGEN_WIDTH ?? "").trim());
  const h = Number((process.env.AUTOMATION_HEYGEN_HEIGHT ?? "").trim());
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 256 && h >= 256 && w <= 1920 && h <= 1920) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  return { ...DEFAULT_DIMENSION };
}

/** Warm default — reads as a soft wall, not stark studio white */
const DEFAULT_BG_COLOR = "#E8E0D4";

function envFlagTrue(name: string): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Per-scene background: solid color (default) or public image URL (cozy room, etc.) */
function heygenBackground(): Record<string, unknown> {
  const imgUrl = (process.env.AUTOMATION_HEYGEN_BG_IMAGE_URL ?? "").trim();
  if (imgUrl) {
    return { type: "image", url: imgUrl, fit: "cover" };
  }
  let hex = (process.env.AUTOMATION_HEYGEN_BG_COLOR ?? DEFAULT_BG_COLOR).trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    hex = DEFAULT_BG_COLOR;
  }
  return { type: "color", value: hex };
}

function heygenVoiceSpeed(): number {
  const raw = (process.env.AUTOMATION_HEYGEN_VOICE_SPEED ?? "0.96").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0.5 && n <= 1.5) {
    return n;
  }
  return 0.96;
}

const VOICE_EMOTIONS = new Set(["Excited", "Friendly", "Serious", "Soothing", "Broadcaster"]);

function heygenVoiceEmotion(): string | undefined {
  const raw = (process.env.AUTOMATION_HEYGEN_VOICE_EMOTION ?? "Friendly").trim();
  if (!raw || /^(none|off)$/i.test(raw)) {
    return undefined;
  }
  return VOICE_EMOTIONS.has(raw) ? raw : "Friendly";
}

function apiKey(): string {
  const k = (process.env.HEYGEN_API_KEY ?? "").trim();
  if (!k) {
    throw new Error("HEYGEN_API_KEY is not set");
  }
  return k;
}

/** HeyGen docs use lowercase `x-api-key`; keep in sync with https://docs.heygen.com/reference/create-an-avatar-video-v2 */
function heygenHeaders(): HeadersInit {
  return { "x-api-key": apiKey(), "Content-Type": "application/json" };
}

function heygenAuthHint(status: number): string {
  if (status !== 401 && status !== 403) {
    return "";
  }
  return (
    "\n\nHeyGen rejected the API key (401/403). Fix: use the key from the HeyGen app (Settings → API / API token). " +
    "Paste it into GitHub → Settings → Secrets and variables → Actions → HEYGEN_API_KEY with no quotes or extra spaces. " +
    "Regenerate the key in HeyGen if it was rotated. Local runs use .env in the repo root."
  );
}

function throwHeygenHttpError(op: string, res: Response, body: string): never {
  const snippet = body.slice(0, 800);
  throw new Error(`HeyGen ${op} ${res.status}: ${snippet}${heygenAuthHint(res.status)}`);
}

/** Truncate caption to a spoken script for avatar TTS. */
export function truncateHeygenScript(text: string, max = MAX_SCRIPT_CHARS): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) {
    return t;
  }
  const slice = t.slice(0, max);
  const lastPeriod = slice.lastIndexOf(".");
  if (lastPeriod > max * 0.5) {
    return slice.slice(0, lastPeriod + 1);
  }
  return `${slice.slice(0, max - 1)}…`;
}

export type GenerateHeygenVideoParams = {
  script: string;
  title: string;
  avatar_id?: string;
  voice_id?: string;
};

/** Start avatar video render; returns HeyGen video_id. */
export async function generateHeygenAvatarVideo(params: GenerateHeygenVideoParams): Promise<string> {
  const avatar_id =
    (params.avatar_id ?? process.env.AUTOMATION_HEYGEN_AVATAR_ID ?? "").trim() || DEFAULT_AVATAR_ID;
  const voice_id =
    (params.voice_id ?? process.env.AUTOMATION_HEYGEN_VOICE_ID ?? "").trim() || DEFAULT_VOICE_ID;

  const dimension = heygenOutputDimension();
  const character: Record<string, unknown> = {
    type: "avatar",
    avatar_id,
    scale: 1,
    avatar_style: "normal",
  };
  if (envFlagTrue("AUTOMATION_HEYGEN_USE_AVATAR_IV")) {
    character.use_avatar_iv_model = true;
  }
  const voice: Record<string, unknown> = {
    type: "text",
    input_text: params.script,
    voice_id,
    speed: heygenVoiceSpeed(),
  };
  const em = heygenVoiceEmotion();
  if (em) {
    voice.emotion = em;
  }
  const res = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: heygenHeaders(),
    body: JSON.stringify({
      caption: false,
      video_inputs: [
        {
          character,
          voice,
          background: heygenBackground(),
        },
      ],
      dimension: { width: dimension.width, height: dimension.height },
      title: params.title.slice(0, 120),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throwHeygenHttpError("generate", res, text);
  }
  const data = JSON.parse(text) as { data?: { video_id?: string } };
  const video_id = data.data?.video_id;
  if (!video_id) {
    throw new Error(`HeyGen did not return video_id: ${text.slice(0, 500)}`);
  }
  return video_id;
}

function extractVideoUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const direct =
      d.video_url ?? d.url ?? (typeof d.video === "object" && d.video !== null
        ? (d.video as Record<string, unknown>).url
        : undefined);
    if (typeof direct === "string" && direct.startsWith("http")) {
      return direct;
    }
  }
  return null;
}

function extractStatus(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === "object") {
    const s = (data as Record<string, unknown>).status;
    if (typeof s === "string") {
      return s.toLowerCase();
    }
  }
  return "";
}

/** Poll until video is ready or failed. Returns downloadable MP4 URL. */
export async function waitForHeygenVideoComplete(
  videoId: string,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 20 * 60_000;
  const pollMs = options?.pollMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      { headers: { "x-api-key": apiKey() } },
    );
    const text = await res.text();
    if (!res.ok) {
      throwHeygenHttpError("status", res, text);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`HeyGen status not JSON: ${text.slice(0, 300)}`);
    }

    lastStatus = extractStatus(json);
    if (lastStatus === "failed" || lastStatus === "error") {
      throw new Error(`HeyGen render failed for ${videoId}: ${text.slice(0, 800)}`);
    }
    const url = extractVideoUrl(json);
    if (url) {
      return url;
    }

    console.log(`[automation] HeyGen status: ${lastStatus || "processing"} — poll again in ${pollMs / 1000}s…`);
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    `HeyGen timeout after ${timeoutMs / 1000}s (last status: ${lastStatus || "unknown"}) video_id=${videoId}`,
  );
}
