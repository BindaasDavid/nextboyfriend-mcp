/**
 * HeyGen avatar video (v2 generate + v1 status poll).
 * @see https://docs.heygen.com/
 */

const DEFAULT_AVATAR_ID = "Daisy-inskirt-20220818";
const DEFAULT_VOICE_ID = "1bd001e7e50f421d891986aad5158bc8";
/** HeyGen text-to-speech input limit — keep under API caps */
const MAX_SCRIPT_CHARS = 300;

function apiKey(): string {
  const k = (process.env.HEYGEN_API_KEY ?? "").trim();
  if (!k) {
    throw new Error("HEYGEN_API_KEY is not set");
  }
  return k;
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

  const res = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST",
    headers: { "X-Api-Key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: "avatar", avatar_id, scale: 1 },
          voice: { type: "text", input_text: params.script, voice_id },
        },
      ],
      dimension: { width: 1080, height: 1920 },
      title: params.title.slice(0, 120),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HeyGen generate ${res.status}: ${text.slice(0, 800)}`);
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
      { headers: { "X-Api-Key": apiKey() } },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HeyGen status ${res.status}: ${text.slice(0, 600)}`);
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
