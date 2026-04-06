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
  if (!res.ok) {
    throw new Error(`SocialAPI ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<unknown>;
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
