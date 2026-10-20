// Lokalise public-signal watch, no account needed. It can't see a silent infra move the way a real
// pull would, but it flags the changes Lokalise ships in the open: a new release of their own CLI or
// Node SDK (they update those when the API changes), and a retired or relocated export bucket in the
// lokalise preset's bundleOrigins. After reviewing a release, bump lokalise-signals.json.
import { readFileSync } from "node:fs";
import { exportApiPresets } from "../../packages/locale/dist/build/index.js";

const reviewed = JSON.parse(readFileSync(new URL("./lokalise-signals.json", import.meta.url), "utf8"));
const problems = [];

async function json(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const ghHeaders = process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {};
const cli = (await json("https://api.github.com/repos/lokalise/lokalise-cli-2-go/releases/latest", ghHeaders)).tag_name;
const sdk = (await json("https://registry.npmjs.org/@lokalise/node-api/latest")).version;
console.log(`lokalise2 CLI latest ${cli} (reviewed ${reviewed.cli}); @lokalise/node-api latest ${sdk} (reviewed ${reviewed.sdk})`);
if (cli !== reviewed.cli) {
  problems.push(`lokalise2 CLI released ${cli} (reviewed ${reviewed.cli}): check its changes to file download / async export`);
}
if (sdk !== reviewed.sdk) {
  problems.push(`@lokalise/node-api released ${sdk} (reviewed ${reviewed.sdk}): check its changes to files.async_download / processes`);
}

// An existing private bucket answers AccessDenied to an anonymous GET. NoSuchBucket means it was
// retired; a redirect code means it moved region. Either way the preset needs another look.
for (const origin of exportApiPresets.lokalise.bundleOrigins) {
  const res = await fetch(origin, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const code = /<Code>([^<]+)<\/Code>/.exec(await res.text())?.[1] ?? `HTTP ${res.status}`;
  console.log(`${origin} -> ${code}`);
  if (code !== "AccessDenied") problems.push(`bundle origin ${origin} answered ${code}, expected AccessDenied (bucket present)`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("no Lokalise changes since the last review");
