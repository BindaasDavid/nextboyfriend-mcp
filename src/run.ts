import "./loadEnv.js";
import { runTikTokAutomation } from "./automation/tiktokPipeline.js";

try {
  await runTikTokAutomation();
} catch (e) {
  console.error(e);
  process.exit(1);
}
