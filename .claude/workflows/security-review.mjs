// Typren whole-repo security review: the multi-agent pass that gates promotions to main.
//
// Claude Code: Workflow({ name: "security-review", args: { head: "<git rev-parse HEAD>", date: "YYYY-MM-DD",
//   slug: "<short-name>", notes: "<optional: what changed, already-fixed items, threat-model updates>" } })
// Then write the returned `record` to security-reviews/<date>-<slug>.md, commit it in the PR, and fix or
// explicitly accept every finding before the record can say `outcome: pass`.
//
// Without Claude Code: follow docs/security-review.md, which runs the same lenses as plain prompts. The
// gate (scripts/check-security-review.mjs) checks the record, not how it was produced.
//
// Shape: four independent surface lenses plus a red-team lead who chains weaknesses across them, then every
// finding is attacked by two skeptics and survives only if neither refutes it, then one synthesis pass
// writes the record. Reviewers are read-only.

export const meta = {
  name: "security-review",
  description: "Whole-repo attack-vector review: 4 surface lenses + red-team chains, adversarial verify, gate record",
  whenToUse: "Before promoting develop to main (required by the security-review gate), or after a large change",
  phases: [
    { title: "Review", detail: "parsing, request/authz, supply chain/CI, edge/integrations, red-team chains" },
    { title: "Verify", detail: "two skeptics try to refute each finding" },
    { title: "Record", detail: "rank survivors and write the gate record" },
  ],
}

const HEAD = args?.head ?? "HEAD"
const NOTES = args?.notes ?? "(none)"

const FINDINGS = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          title: { type: "string" },
          path: { type: "string" },
          line: { type: "number" },
          attacker: { type: "string" },
          exploit: { type: "string" },
          impact: { type: "string" },
          fix: { type: "string" },
          confidence: { type: "string", enum: ["confirmed", "plausible"] },
        },
        required: ["severity", "title", "path", "attacker", "exploit", "impact", "fix", "confidence"],
      },
    },
    clean: { type: "array", items: { type: "string" } },
  },
  required: ["findings", "clean"],
}

const VERDICT = {
  type: "object",
  properties: {
    refuted: { type: "boolean" },
    reason: { type: "string" },
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
  },
  required: ["refuted", "reason", "severity"],
}

const BRIEF = `You are reviewing the Typren monorepo at commit ${HEAD} (packages/*, scripts/, .github/workflows/, .husky/,
templates written by \`typren init\`). Review the WHOLE repo, not a diff. Docs in docs/site/ (security-model, auth-model,
security-checklist) and SECURITY.md describe intended guarantees; a gap between them and the code is a finding.

Rules: READ-ONLY. Do not edit files, do not run git commands that write (add/commit/config/checkout/stash/init/push), do not call
real external services, do not run the CLI against this repository. Repros go in a temp dir; any git you spawn there uses an env
with GIT_* variables removed. Never run a single-package \`vitest --coverage\` (it rewrites thresholds).

Threat actors: anonymous visitor, low-privilege editor/author, content contributor via PR, malicious npm or remote-note
publisher, another tenant (hosted tier), compromised third party (IdP, TMS, Notion, HubSpot, webhook receiver).

Reviewer notes for this run (already-fixed items, scope changes): ${NOTES}

Report every real finding with: severity, file path and line, attacker, concrete exploit steps or payload, impact, fix, and
confidence "confirmed" (you traced the full path or reproduced it) or "plausible" (depends on host config; say which). No style
nits, no praise. Also list in \`clean\` what you verified holds.`

const LENSES = [
  {
    key: "parsing",
    prompt: `${BRIEF}

Your lens: PARSING, RENDERING & INJECTION. Front matter and YAML (engines, aliases, size), markdown and HTML output (mirror,
llms.txt, SEO helpers, JSON-LD, sitemap), SVG sanitization and media processing, prototype pollution in every merge, ReDoS in
every regex applied to input, path joins from slugs/locales/ids, and code generation by \`typren init\`.`,
  },
  {
    key: "request",
    prompt: `${BRIEF}

Your lens: REQUEST SURFACE & AUTHORIZATION. Every route handler and server action: which auth action guards it, whether reads
are gated, IDOR across slugs/locales/collections, admin escalation, CSRF/Origin checks, CORS, cache poisoning of auth-dependent
responses, the editor/preview postMessage bridge and iframe isolation, the admin-route proxy, error-message leakage, and dev-only
adapters reachable in production.`,
  },
  {
    key: "supply-chain",
    prompt: `${BRIEF}

Your lens: SUPPLY CHAIN, CI/CD & CLI. Workflows (pull_request_target, script injection, token permissions, which jobs hold
id-token, action pinning, fork PR behavior, the release/publish path), hooks, install/postinstall scripts, published tarball
contents, lockfile integrity, and every CLI command that shells out (git/npx/wrangler/aws argument injection, temp files,
symlinks, telemetry).`,
  },
  {
    key: "edge",
    prompt: `${BRIEF}

Your lens: EDGE RUNTIME, INTEGRATIONS & DATA EGRESS. Static-host routing and redirects on every host (open redirects, encoded
separators, header injection, canonical-host loops), forms sinks (SSRF, redirects, formula/field injection, body limits, error
leakage), locale OTA and TMS bundles (integrity, traversal, HTML gate), media adapters, configurable endpoints (SSRF, token
leakage), and module-level caches that could bleed between tenants.`,
  },
]

const RED_TEAM = `${BRIEF}

You are the RED TEAM LEAD. Four parallel reviewers each take one surface; you think in attacker campaigns. For each threat
actor, build the most damaging realistic END-TO-END chain across packages and trust boundaries, where individually small
weaknesses compose into high impact, and name the cheapest link to break. Also check the security docs against what the code
enforces and the defaults a typical \`typren init\` user deploys. Report each chain as one finding (path = the weakest link).`

phase("Review")
const reviews = await parallel([
  ...LENSES.map((l) => () => agent(l.prompt, { label: `lens:${l.key}`, phase: "Review", schema: FINDINGS, model: "opus" })),
  // The red team runs on the strongest available model; fall back to Opus where Fable isn't available.
  () =>
    agent(RED_TEAM, { label: "red-team", phase: "Review", schema: FINDINGS, model: "fable" }).then(
      (r) => r ?? agent(RED_TEAM, { label: "red-team (opus)", phase: "Review", schema: FINDINGS, model: "opus" })
    ),
])

const failedLenses = ["parsing", "request", "supply-chain", "edge", "red-team"].filter((_, i) => !reviews[i])
if (failedLenses.length) log(`WARNING: no result from ${failedLenses.join(", ")}; the record will say the review is incomplete`)

// Barrier is deliberate: the same weakness is usually found by several lenses, and verifying duplicates wastes the
// most expensive stage.
const key = (f) => `${f.path}:${f.line ?? ""}:${f.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60)}`
const seen = new Map()
for (const f of reviews.filter(Boolean).flatMap((r) => r.findings)) {
  const k = key(f)
  if (!seen.has(k)) seen.set(k, f)
}
const unique = [...seen.values()]
log(`${unique.length} unique findings to verify`)

phase("Verify")
const verified = await parallel(
  unique.map((f) => () =>
    parallel([0, 1].map((n) => () =>
      agent(
        `${BRIEF}

Try to REFUTE this security finding. Trace the code yourself; a finding survives only if the exploit path is real at commit
${HEAD} and not already blocked elsewhere. If it is real, re-rate its severity honestly. Default to refuted=true only if you
can point at the code that blocks it.

${JSON.stringify(f, null, 2)}`,
        { label: `verify:${f.path}#${n}`, phase: "Verify", schema: VERDICT, model: "opus", effort: "high" }
      )
    )).then((votes) => {
      const v = votes.filter(Boolean)
      const survives = v.length > 0 && v.every((x) => !x.refuted)
      const order = ["low", "medium", "high", "critical"]
      const severity = survives ? v.map((x) => x.severity).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] : f.severity
      return { ...f, severity, survives, verdicts: v }
    })
  )
)

const confirmed = verified.filter((f) => f && f.survives)
const refuted = verified.filter((f) => f && !f.survives)
const open = (s) => confirmed.filter((f) => f.severity === s).length
log(`${confirmed.length} confirmed (${open("critical")} critical, ${open("high")} high), ${refuted.length} refuted`)

phase("Record")
const record = await agent(
  `Write a security review record in Markdown for the Typren repo, reviewed at commit ${HEAD}.

Start with YAML front matter EXACTLY in this shape (fill values; keep keys):
---
reviewedHead: ${HEAD}
date: ${args?.date ?? "YYYY-MM-DD"}
method: workflow
outcome: ${open("critical") + open("high") === 0 && failedLenses.length === 0 ? "pass" : "fail"}
open:
  critical: ${open("critical")}
  high: ${open("high")}
  medium: ${open("medium")}
  low: ${open("low")}
incomplete: [${failedLenses.join(", ")}]
---

Then: a one-paragraph summary; a ranked table of confirmed findings (severity, title, path:line, fix); a short list of refuted
claims with the reason; and "Verified clean" bullets merged from the reviewers. Plain, factual prose. Do not mention any
employer, client or private site. Return ONLY the Markdown.

Confirmed findings: ${JSON.stringify(confirmed.map(({ verdicts, survives, ...f }) => f))}
Refuted: ${JSON.stringify(refuted.map((f) => ({ title: f.title, path: f.path, reason: f.verdicts.map((v) => v.reason).join(" / ") })))}
Clean: ${JSON.stringify(reviews.filter(Boolean).flatMap((r) => r.clean))}`,
  { label: "record", phase: "Record", model: "opus" }
)

return {
  outcome: open("critical") + open("high") === 0 && failedLenses.length === 0 ? "pass" : "fail",
  open: { critical: open("critical"), high: open("high"), medium: open("medium"), low: open("low") },
  incomplete: failedLenses,
  confirmed: confirmed.map(({ verdicts, survives, ...f }) => f),
  refutedCount: refuted.length,
  record,
}
