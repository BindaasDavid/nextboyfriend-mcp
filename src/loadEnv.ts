import { config } from "dotenv";
import dns from "node:dns";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Prefer IPv4 when both A and AAAA exist — avoids undici `fetch failed` on broken IPv6 routes. */
dns.setDefaultResultOrder("ipv4first");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });
config({ path: join(process.cwd(), ".env") });
