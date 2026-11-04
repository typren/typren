---
package: "@typren/core"
version: "0.7.0"
title: "typren studio opens the cloud studio by default"
detect:
  - pattern: "typren studio(?!\\s+--local)"
    glob: "**/*.{json,md,yml,yaml,mjs,js,ts,sh}"
    hint: "`typren studio` now opens the studio UI from the cloud and runs only the content API on this machine. Add `--local` to keep the local studio UI (needs @typren/studio-local)."
  - pattern: "@typren/studio-local"
    glob: "package.json"
    hint: "Only `typren studio --local` needs @typren/studio-local now. Keep it for the local studio UI, or drop the dev dependency and use the cloud studio."
  - pattern: "--typren-stroke-control-edge"
    glob: "**/*.{css,scss,ts,tsx,js,jsx,mdx}"
    hint: "Removed: every control draws one even hairline. Override --typren-elevation* to restore a darker edge."
---
## What changed

`typren studio` now opens the studio UI from the cloud,
`https://app.typren.com/connect`, instead of starting a second Next.js app
on your machine. The CLI keeps running the content API on `127.0.0.1`, for
that one origin only, with a per-session pairing token carried in the link's
`#fragment`; your content never goes through the cloud's server. The
connected studio needs no sign-in.

`--local`, accepted since 0.6, keeps the previous behaviour: the studio UI on
`127.0.0.1:4400` from `@typren/studio-local`, which is now needed only for
that flag. `--cloud-url <url>` (or `TYPREN_CLOUD_URL`) points at another
cloud origin, https only except on loopback. The 0.6 heads-up line on stderr
is gone.

Every control (inputs, buttons, selects, accent buttons) draws one even
hairline instead of a darker bottom or top edge. The
`--typren-stroke-control-edge` token is removed.

Not breaking, but new defaults worth knowing: `SeoConfig.homeSlug` gives the
home page the canonical `/`, `DEFAULT_AI_CRAWLERS` names the current
answer-engine agents, and `noindex` pages stay out of `llms-full.txt` and the
`.md` mirror. Sites using `@typren/locale` have their own breaking change in
0.4.0 (signed OTA manifests); its CHANGELOG carries the steps.

## Fix

1. Run `typren studio`. The browser opens the cloud studio paired to your
   local API. Add `--local` to any script or doc that expects the studio UI
   itself on `127.0.0.1:4400`.
2. Keep `@typren/studio-local` as a dev dependency only if you use `--local`;
   otherwise drop it.
3. Replace any `--typren-stroke-control-edge` override with the
   `--typren-elevation*` tokens.

## Verify

`typren studio` opens `https://app.typren.com/connect#port=…&token=…` and
shows your pages; `typren studio --local` still serves the studio at
`http://127.0.0.1:4400`. A search for `typren-stroke-control-edge` in your
site finds nothing.
