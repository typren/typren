// Live TMS canary: pulls a real project through one shipped export-api preset, so a vendor-side
// change (export host, response shape, locale naming) surfaces here instead of in a consumer's build.
// Usage: node scripts/canary/provider.mjs <preset>
// Env: <PRESET>_CANARY_TOKEN, <PRESET>_CANARY_PROJECT_ID, optional <PRESET>_CANARY_EXPECTED_LOCALES
// (comma-separated canonical keys, default "en").
import { resolveProvider } from "../../packages/locale/dist/build/index.js";

const preset = process.argv[2];
if (!preset) {
  console.error("usage: node scripts/canary/provider.mjs <preset>");
  process.exit(2);
}
const P = preset.toUpperCase();
const tokenVar = `${P}_CANARY_TOKEN`;
const projectId = process.env[`${P}_CANARY_PROJECT_ID`];
if (!process.env[tokenVar] || !projectId) {
  console.log(`::warning::${preset} canary not configured (${tokenVar} / ${P}_CANARY_PROJECT_ID missing); skipped`);
  process.exit(0);
}
const expected = (process.env[`${P}_CANARY_EXPECTED_LOCALES`] || "en")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const catalogs = await resolveProvider({ type: "export-api", preset, projectId, token: `\${${tokenVar}}` }).loadSource();
const locales = Object.keys(catalogs).sort();
const missing = expected.filter((l) => !locales.includes(l));
const empty = locales.filter((l) => {
  const c = catalogs[l];
  return !c || typeof c !== "object" || Object.keys(c).length === 0;
});

console.log(`${preset}: ${locales.length} locale(s): ${locales.join(", ") || "(none)"}`);
if (missing.length || empty.length) {
  if (missing.length) console.error(`${preset}: expected locale(s) missing: ${missing.join(", ")}`);
  if (empty.length) console.error(`${preset}: empty catalog(s): ${empty.join(", ")}`);
  process.exit(1);
}
