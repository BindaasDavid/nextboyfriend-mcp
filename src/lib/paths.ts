import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(__dirname, "..", "..");

export function resolveProjectPath(p: string): string {
  return isAbsolute(p) ? p : join(PROJECT_ROOT, p);
}
