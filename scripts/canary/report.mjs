// Files, updates or closes the GitHub issue for one canary, keyed by its exact title.
// Failure: open the issue (or comment on the open one) with the run link. Success: close it.
// Usage: node scripts/canary/report.mjs --title "<title>" --outcome <success|failure|...> --run-url <url>
// Needs GH_TOKEN with issues: write and GITHUB_REPOSITORY.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { title: { type: "string" }, outcome: { type: "string" }, "run-url": { type: "string" } } });
const { title, outcome } = values;
const runUrl = values["run-url"] ?? "";
if (!title || !outcome) {
  console.error("usage: report.mjs --title <title> --outcome <outcome> --run-url <url>");
  process.exit(2);
}
const repo = process.env.GITHUB_REPOSITORY;
const gh = (...args) => execFileSync("gh", [...args, "--repo", repo], { encoding: "utf8" });

gh("label", "create", "canary", "--color", "B60205", "--description", "Scheduled compatibility canary failure", "--force");
const open = JSON.parse(gh("issue", "list", "--label", "canary", "--state", "open", "--limit", "100", "--json", "number,title"));
const existing = open.find((i) => i.title === title);

if (outcome === "success") {
  if (existing) {
    gh("issue", "close", String(existing.number), "--comment", `Passing again: ${runUrl}`);
    console.log(`closed #${existing.number}`);
  }
} else if (outcome === "failure") {
  const body = `The scheduled canary failed: ${runUrl}\n\nOpen the run for the log. This issue closes itself on the next passing run.`;
  if (existing) {
    gh("issue", "comment", String(existing.number), "--body", `Still failing: ${runUrl}`);
    console.log(`commented on #${existing.number}`);
  } else {
    console.log(gh("issue", "create", "--title", title, "--label", "canary", "--body", body).trim());
  }
} else {
  console.log(`outcome "${outcome}": nothing to report`);
}
