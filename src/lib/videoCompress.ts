import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const FFMPEG = (require("ffmpeg-static") as string | null) ?? "ffmpeg";

/** Stay under typical nginx client_max_body_size (often 8–16 MB). Configurable via env. */
function socialUploadMaxBytes(): number {
  const raw = (process.env.AUTOMATION_SOCIAL_VIDEO_MAX_BYTES ?? "").trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 512 * 1024) {
      return Math.floor(n);
    }
  }
  return 6 * 1024 * 1024;
}

type Tier = { vf: string; crf: string; fps: string; a: string };

const TIERS: Tier[] = [
  { vf: "scale=540:-2", crf: "30", fps: "24", a: "64k" },
  { vf: "scale=480:-2", crf: "32", fps: "24", a: "48k" },
  { vf: "scale=360:-2", crf: "34", fps: "24", a: "48k" },
];

function runFfmpeg(inPath: string, outPath: string, tier: Tier): void {
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-i",
      inPath,
      "-c:v",
      "libx264",
      "-crf",
      tier.crf,
      "-preset",
      "veryfast",
      "-vf",
      tier.vf,
      "-r",
      tier.fps,
      "-c:a",
      "aac",
      "-b:a",
      tier.a,
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { stdio: "pipe", maxBuffer: 80 * 1024 * 1024 },
  );
}

/** Bitrate-capped pass when CRF tiers still exceed max (short clips, hard ceiling). */
function runFfmpegBitrateCap(inPath: string, outPath: string): void {
  execFileSync(
    FFMPEG,
    [
      "-y",
      "-i",
      inPath,
      "-c:v",
      "libx264",
      "-b:v",
      "450k",
      "-maxrate",
      "550k",
      "-bufsize",
      "1100k",
      "-preset",
      "veryfast",
      "-vf",
      "scale=360:-2",
      "-r",
      "24",
      "-c:a",
      "aac",
      "-b:a",
      "40k",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { stdio: "pipe", maxBuffer: 80 * 1024 * 1024 },
  );
}

/**
 * Re-encode MP4 for SocialAPI /media/upload (avoids nginx 413).
 * Runs progressively smaller tiers until under AUTOMATION_SOCIAL_VIDEO_MAX_BYTES (default 6 MiB).
 */
export function compressMp4ForSocialUpload(input: Buffer): Buffer {
  const maxBytes = socialUploadMaxBytes();
  const dir = mkdtempSync(join(tmpdir(), "nb-mcp-vid-"));
  const inputPath = join(dir, "in.mp4");
  try {
    writeFileSync(inputPath, input);
    let currentPath = inputPath;
    let best = input;
    for (let i = 0; i < TIERS.length; i++) {
      const tier = TIERS[i];
      if (!tier) {
        break;
      }
      const outPath = join(dir, `t${i}.mp4`);
      runFfmpeg(currentPath, outPath, tier);
      const buf = readFileSync(outPath);
      if (buf.length === 0) {
        throw new Error(`ffmpeg tier ${i} produced empty output`);
      }
      best = buf;
      if (buf.length <= maxBytes) {
        return buf;
      }
      currentPath = outPath;
    }
    const capPath = join(dir, "cap.mp4");
    runFfmpegBitrateCap(currentPath, capPath);
    const capped = readFileSync(capPath);
    if (capped.length === 0) {
      throw new Error("ffmpeg bitrate-capped pass produced empty output");
    }
    if (capped.length > maxBytes) {
      console.warn(
        `[automation] MP4 still ${(capped.length / 1e6).toFixed(2)} MB after compression (target ${(maxBytes / 1e6).toFixed(1)} MB) — uploading anyway; if SocialAPI returns 413, shorten the HeyGen script or lower AUTOMATION_SOCIAL_VIDEO_MAX_BYTES and ensure tiers run.`,
      );
    }
    return capped;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
