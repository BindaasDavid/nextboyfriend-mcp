import { compressMp4ForSocialUpload } from "./videoCompress.js";

const SOCIAL_BASE = "https://api.social-api.ai/v1";

/** Single SocialAPI.ai API key — same Bearer for TikTok, Instagram, X, etc. */
function bearer(): string {
  return (process.env.SOCAPI_KEY ?? process.env.SOCIAL_API_KEY ?? "").trim();
}

export async function socialApi(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const token = bearer();
  if (!token) {
    throw new Error("SOCAPI_KEY or SOCIAL_API_KEY is not set");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
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

/** Multipart upload — do not set Content-Type (fetch sets boundary). */
export async function socialApiMultipartUpload(
  path: string,
  formData: FormData,
): Promise<unknown> {
  const token = bearer();
  if (!token) {
    throw new Error("SOCAPI_KEY or SOCIAL_API_KEY is not set");
  }
  const res = await fetch(`${SOCIAL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const errBody = await res.text();
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error(
        `SocialAPI 413: upload too large for /media/upload. ` +
          `Use smaller HeyGen output (AUTOMATION_HEYGEN_WIDTH/HEIGHT, default 720×1280) and keep ffmpeg re-encode on (clear AUTOMATION_SKIP_HEYGEN_REENCODE). ` +
          errBody.slice(0, 200),
      );
    }
    throw new Error(`SocialAPI ${res.status}: ${errBody}`);
  }
  try {
    return JSON.parse(errBody) as unknown;
  } catch {
    throw new Error(`SocialAPI: expected JSON from /media/upload, got: ${errBody.slice(0, 200)}`);
  }
}

/** Upload arbitrary bytes (image or video) to SocialAPI; returns `media_id` for `POST /posts`. */
export async function uploadMediaBuffer(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<string> {
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  const form = new FormData();
  form.append("file", blob, filename);
  const data = (await socialApiMultipartUpload("/media/upload", form)) as { media_id?: string };
  if (!data.media_id) {
    throw new Error(`SocialAPI /media/upload missing media_id: ${JSON.stringify(data)}`);
  }
  return data.media_id;
}

/** Download a remote URL (Pollinations, HeyGen MP4, etc.) and upload to SocialAPI. */
export async function uploadMediaFromRemoteUrl(
  remoteUrl: string,
  filename: string,
  downloadTimeoutMs = 600_000,
): Promise<string> {
  const downloadRes = await fetch(remoteUrl, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!downloadRes.ok) {
    throw new Error(`Media download failed (${downloadRes.status}): ${remoteUrl.slice(0, 160)}`);
  }
  const ct = downloadRes.headers.get("content-type") ?? "application/octet-stream";
  const buf = Buffer.from(await downloadRes.arrayBuffer());
  return uploadMediaBuffer(buf, ct, filename);
}

/**
 * HeyGen MP4 → optional ffmpeg pass (smaller H.264) → SocialAPI /media/upload.
 * Set AUTOMATION_SKIP_HEYGEN_REENCODE=true to upload the raw HeyGen file (may hit 413 on large 1080p renders).
 */
export async function uploadHeygenMp4ToSocial(mp4Url: string, filename: string): Promise<string> {
  const downloadRes = await fetch(mp4Url, { signal: AbortSignal.timeout(600_000) });
  if (!downloadRes.ok) {
    throw new Error(`HeyGen MP4 download failed (${downloadRes.status}): ${mp4Url.slice(0, 160)}`);
  }
  const ct = downloadRes.headers.get("content-type") ?? "video/mp4";
  let buf: Buffer = Buffer.from(await downloadRes.arrayBuffer());
  const skip = ["1", "true", "yes"].includes(
    String(process.env.AUTOMATION_SKIP_HEYGEN_REENCODE ?? "").toLowerCase(),
  );
  if (!skip) {
    try {
      const next = compressMp4ForSocialUpload(buf);
      console.log(
        `[automation] Re-encoded MP4 for SocialAPI: ${(buf.length / 1e6).toFixed(2)} MB → ${(next.length / 1e6).toFixed(2)} MB`,
      );
      buf = Buffer.from(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[automation] ffmpeg re-encode failed (${msg}) — uploading original bytes`);
    }
  }
  return uploadMediaBuffer(buf, ct, filename);
}

/**
 * Download Pollinations image bytes and upload to SocialAPI storage.
 * CreatePostRequest uses `media_ids`, not `media_urls` — remote URLs are ignored.
 */
export async function uploadMediaFromPollinationsUrl(imageUrl: string): Promise<string> {
  const downloadRes = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
  if (!downloadRes.ok) {
    throw new Error(
      `Pollinations download failed (${downloadRes.status}). URL: ${imageUrl.slice(0, 160)}`,
    );
  }
  const ct = downloadRes.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await downloadRes.arrayBuffer());
  const ext =
    ct.includes("jpeg") || ct.includes("jpg")
      ? "jpg"
      : ct.includes("webp")
        ? "webp"
        : "png";
  return uploadMediaBuffer(buf, ct, `tiktok-cover.${ext}`);
}
