export type PollinationsFormat = "square" | "portrait" | "landscape" | "story";

const DIMS: Record<PollinationsFormat, [number, number]> = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  landscape: [1200, 630],
  story: [1080, 1920],
};

export function buildPollinationsImageUrl(
  prompt: string,
  format: PollinationsFormat = "story",
): { image_url: string; width: number; height: number } {
  const [w, h] = DIMS[format];
  const encoded = encodeURIComponent(prompt);
  const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&nologo=true&model=flux&enhance=true`;
  return { image_url: imageUrl, width: w, height: h };
}
