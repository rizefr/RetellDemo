import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const nextUrl = process.argv[2]?.trim();
const allowedPrefix = "https://agent.retellai.com/orb/";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!nextUrl) {
  fail('Usage: npm run set:demo-url -- "https://agent.retellai.com/orb/AGENT_ID?token=PUBLIC_TOKEN"');
}

let parsed;
try {
  parsed = new URL(nextUrl);
} catch {
  fail("The demo URL is not a valid URL.");
}

if (!nextUrl.startsWith(allowedPrefix)) {
  fail(`Demo URL must start with ${allowedPrefix}`);
}

if (parsed.hostname !== "agent.retellai.com" || !parsed.pathname.startsWith("/orb/")) {
  fail("Only Retell public orb URLs are allowed. Dashboard and API URLs are not allowed.");
}

if (nextUrl.includes("api.retellai.com") || nextUrl.includes("dashboard.retellai.com")) {
  fail("Do not paste Retell API or dashboard URLs into the public demo config.");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(scriptDir, "..", "public", "site-config.js");
const config = await readFile(configPath, "utf8");
const escapedUrl = nextUrl.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const orbUrlPattern = /AI_DEMO_ORB_URL:\s*"[^"]*"/;

if (!orbUrlPattern.test(config)) {
  fail("Could not find AI_DEMO_ORB_URL in public/site-config.js.");
}

const updated = config.replace(orbUrlPattern, `AI_DEMO_ORB_URL: "${escapedUrl}"`);

if (updated === config) {
  console.log("AI_DEMO_ORB_URL already matches the provided public Retell orb URL.");
  process.exit(0);
}

await writeFile(configPath, updated, "utf8");
console.log("Updated public/site-config.js with the new public Retell orb URL.");
console.log("Run npm run build, then commit and push the change.");
