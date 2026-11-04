---
"@typren/core": minor
---

New `@typren/core/tags`: consent-gated third-party tags for every Typren site. One tag engine (`createTagEngine`) reads the visitor's consent and decides which tags run, with adapters for Google Tag Manager, GA4, the Meta Pixel and any one-URL vendor script (HubSpot, LinkedIn Insight, …). Google Consent Mode v2 is built in: `consentMode: "regional"` (the default) keeps EU/EEA/UK visitors on strict opt-in and loads Consent Mode tags cookieless elsewhere; `"strict"` waits for opt-in everywhere. `productionHost` and `disabled` keep staging and previews out of production properties. `@typren/core/ui/typren-tags` mounts the tags and exports `useConsent`; `@typren/core/ui/consent-banner` is a default banner themed from the site's `--typren-*` tokens.
