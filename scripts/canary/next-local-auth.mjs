// Real-framework canary: boots `next dev` (any version) on loopback with a route guarded by
// localAuth and checks it over real HTTP. Mocked headers() can't show what Next itself does to a
// request (it injects x-forwarded-* on every one), so this runs the real server.
// Usage: node scripts/canary/next-local-auth.mjs <next version or dist-tag>
import { execFileSync, spawn } from "node:child_process";
import { get } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const requested = process.argv[2] || "latest";
// Pin the dist-tag to an exact version: a bare "canary" lets npm fall back to stable when a peer
// range (core's next >=15) excludes the prerelease, and the run would test the wrong release.
const version = execFileSync("npm", ["view", `next@${requested}`, "version"], { encoding: "utf8" }).trim().split("\n").pop();
const core = resolve(import.meta.dirname, "../../packages/core");
const dir = mkdtempSync(join(tmpdir(), "typren-next-canary-"));
const port = 39000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;

// A packed tarball, as a consumer installs it: Next's bundler won't follow a file: symlink out of the app.
const tarball = join(dir, execFileSync("npm", ["pack", core, "--pack-destination", dir, "--silent"], { encoding: "utf8" }).trim().split("\n").pop());
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({
    private: true,
    dependencies: { next: version, react: "latest", "react-dom": "latest", "@typren/core": `file:${tarball}` },
  })
);
mkdirSync(join(dir, "app/api/canary"), { recursive: true });
writeFileSync(
  join(dir, "app/api/canary/route.js"),
  `import { localAuth } from "@typren/core/auth/local";
export const dynamic = "force-dynamic";
export async function GET() {
  const ok = await localAuth().authorize({ action: "saveDraft" });
  return new Response(ok ? "ok" : "denied", { status: ok ? 200 : 403 });
}
`
);

execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--legacy-peer-deps"], { cwd: dir, stdio: "inherit" });
const nextVersion = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('next/package.json').version)"], { cwd: dir, encoding: "utf8" }));
const exportsForwarded = execFileSync(
  "node",
  ["--input-type=module", "-e", "import('@typren/core/auth/local').then(m => console.log(typeof m.isForwardedRequest === 'function'))"],
  { cwd: dir, encoding: "utf8" }
).trim() === "true";
console.log(`next ${nextVersion} (requested ${requested}); isForwardedRequest exported: ${exportsForwarded}`);
if (nextVersion !== version) {
  console.error(`FAIL installed next ${nextVersion}, but ${requested} resolves to ${version}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

const server = spawn(join(dir, "node_modules/.bin/next"), ["dev", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: dir,
  env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "inherit", "inherit"],
});

// node:http, not fetch: fetch replaces a caller-set Host header with the URL's.
function status(headers = {}) {
  return new Promise((ok, fail) => {
    const req = get(`${base}/api/canary`, { headers, timeout: 60_000 }, (res) => {
      res.resume();
      ok(res.statusCode);
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", fail);
  });
}

const cases = [
  ["a direct loopback request is authorized", {}, 200],
  ["a non-loopback Host header is refused", { host: "attacker.example" }, 403],
];
if (exportsForwarded) {
  cases.push(
    ["a non-loopback X-Forwarded-For hop is refused", { "x-forwarded-for": "203.0.113.9" }, 403],
    ["a Forwarded header is refused", { forwarded: "for=203.0.113.9" }, 403]
  );
}

let failed = 0;
try {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      await status();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("next dev did not answer within 120s");
      await sleep(1000);
    }
  }
  for (const [name, headers, want] of cases) {
    const got = await status(headers);
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: expected ${want}, got ${got}`);
  }
} catch (e) {
  failed++;
  console.error(`FAIL ${e instanceof Error ? e.message : e}`);
} finally {
  server.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
