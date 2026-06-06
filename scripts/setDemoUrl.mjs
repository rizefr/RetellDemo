import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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
const publicDir = path.join(scriptDir, "..", "public");
const configPath = path.join(publicDir, "site-config.js");
const siteJsPath = path.join(publicDir, "site.js");
const indexPath = path.join(publicDir, "index.html");
const demoIndexPath = path.join(publicDir, "demo", "index.html");
const escapedUrl = nextUrl.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const orbUrlPattern = /AI_DEMO_ORB_URL:\s*"[^"]*"/;
const htmlOrbUrlPattern = /https:\/\/agent\.retellai\.com\/orb\/[^"\s<]+/g;
const cacheTag = `demo-${createHash("sha256").update(nextUrl).digest("hex").slice(0, 12)}`;

async function updateFile(filePath, updater) {
  const current = await readFile(filePath, "utf8");
  const updated = updater(current);

  if (updated === current) return false;
  await writeFile(filePath, updated, "utf8");
  return true;
}

const changedFiles = [];

if (await updateFile(configPath, (content) => {
  if (!orbUrlPattern.test(content)) {
    fail("Could not find AI_DEMO_ORB_URL in public/site-config.js.");
  }
  return content.replace(orbUrlPattern, `AI_DEMO_ORB_URL: "${escapedUrl}"`);
})) {
  changedFiles.push("public/site-config.js");
}

if (await updateFile(siteJsPath, (content) => {
  if (!orbUrlPattern.test(content)) {
    fail("Could not find AI_DEMO_ORB_URL in public/site.js.");
  }
  return content.replace(orbUrlPattern, `AI_DEMO_ORB_URL: "${escapedUrl}"`);
})) {
  changedFiles.push("public/site.js");
}

if (await updateFile(indexPath, (content) => {
  const withOrbUrl = content.replace(htmlOrbUrlPattern, nextUrl);
  return withOrbUrl
    .replace(/\/site-config\.js(?:\?v=[^"]*)?/g, `/site-config.js?v=${cacheTag}`)
    .replace(/\/site\.js(?:\?v=[^"]*)?/g, `/site.js?v=${cacheTag}`);
})) {
  changedFiles.push("public/index.html");
}

if (await updateFile(demoIndexPath, (content) => content.replace(htmlOrbUrlPattern, nextUrl))) {
  changedFiles.push("public/demo/index.html");
}

if (changedFiles.length === 0) {
  console.log("All public AI demo URL references already match the provided Retell orb URL.");
} else {
  console.log(`Updated ${changedFiles.join(", ")}.`);
}

console.log(`Frontend cache tag: ${cacheTag}`);
console.log("Run the verification commands in README_WEBSITE.md, then commit and push the change.");
