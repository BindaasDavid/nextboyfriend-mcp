import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const FFMPEG = (require("ffmpeg-static") as string | null) ?? "ffmpeg";

/**
 * Re-encode MP4 for smaller file size before SocialAPI multipart upload (avoids nginx 413).
 * Uses H.264 + AAC, max width 720 (9:16 friendly), faststart for streaming.
 */
export function compressMp4ForSocialUpload(input: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "nb-mcp-vid-"));
  const inputPath = join(dir, "in.mp4");
  const outputPath = join(dir, "out.mp4");
  try {
    writeFileSync(inputPath, input);
    execFileSync(
      FFMPEG,
      [
        "-y",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-crf",
        "26",
        "-preset",
        "veryfast",
        "-vf",
        "scale=720:-2",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: "pipe", maxBuffer: 80 * 1024 * 1024 },
    );
    const out = readFileSync(outputPath);
    if (out.length === 0) {
      throw new Error("ffmpeg produced empty output");
    }
    return out;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
