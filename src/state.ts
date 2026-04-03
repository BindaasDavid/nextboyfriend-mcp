import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "..", ".article-state.json");

export interface ArticleState {
  last_fetched_at: string;
  seen_slugs: string[];
}

export function loadState(): ArticleState {
  if (!existsSync(STATE_FILE)) {
    return { last_fetched_at: "2025-01-01T00:00:00Z", seen_slugs: [] };
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as ArticleState;
}

export function saveState(state: ArticleState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
