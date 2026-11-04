---
title: Tags and consent
description: Load Google Tag Manager, GA4, the Meta Pixel and other vendor tags behind visitor consent, with Google Consent Mode v2.
category: Guides
order: 22
---

`@typren/core/tags` is one tag engine with an adapter per vendor. The engine
reads the visitor's consent, decides which tags may run, and fans site events
out to them. Adapters follow the same shape as every other Typren adapter: a
`create*Adapter(opts)` factory returning a plain object.

| Adapter | Category | Consent Mode | Events |
| --- | --- | --- | --- |
| `createGtmAdapter({ containerId })` | marketing | opt-in (`consentMode: true`) | pushed onto `dataLayer` |
| `createGa4Adapter({ measurementId })` | analytics | yes | `gtag('event', …)` |
| `createMetaPixelAdapter({ pixelId })` | marketing | no | `fbq('track' \| 'trackCustom', …)` |
| `createScriptAdapter({ name, src, category })` | yours | no | none (HubSpot, LinkedIn Insight, Hotjar, …) |

IDs are validated to their vendor's shape, because they are written into
inline script source.

## Wiring it into a site

The engine holds functions, so create it in a client module and mount the
loader and banner from there:

```tsx
// app/tags.tsx
"use client";
import { createTagEngine, createGa4Adapter, createGtmAdapter } from "@typren/core/tags";
import { TyprenTags } from "@typren/core/ui/typren-tags";
import { ConsentBanner } from "@typren/core/ui/consent-banner";

export const tags = createTagEngine({
  policyVersion: "2026-11-04",
  productionHost: "www.example.com",
  adapters: [
    createGtmAdapter({ containerId: "GTM-ABC123" }),
    createGa4Adapter({ measurementId: "G-ABC123" }),
  ],
});

export function Tags() {
  return (
    <>
      <TyprenTags engine={tags} />
      <ConsentBanner store={tags.consent} policyHref="/cookie-policy" />
    </>
  );
}
```

Render `<Tags />` once in the root layout. Nothing is in the server HTML: tags
mount on the client once the region and the visitor's decision are known.

- `policyVersion`: bump it whenever your tags or cookie policy materially
  change. A decision recorded under another version reads as unset, so the
  banner asks again.
- `productionHost`: tags load only on that hostname, so staging, previews
  and localhost, which ship the same bundle, never report into production
  properties.
- `disabled`: a kill switch that wins over any consent.
- `cookieName` (default `typren-consent`) and `maxAgeDays` (default 183).

## Consent posture

`consentMode` is the site owner's choice:

- `"regional"` (default): in the EU, EEA and UK nothing loads before opt-in.
  Elsewhere, tags that honour Google Consent Mode v2 (GA4, and GTM when you set
  `consentMode: true` on it) load at once with every storage signal `denied`,
  so Google can model unconsented traffic without cookies, and switch to
  `granted` when the visitor accepts. Tags without Consent Mode stay gated
  everywhere.
- `"strict"`: nothing loads before opt-in, in any region.

The region comes from the browser's timezone, with no network call. It
over-includes (a VPN or a non-EU European zone reads as strict), which errs
toward the stricter treatment. Get legal sign-off before choosing
`"regional"` for a site with EU traffic you can't place by timezone.

Only set `consentMode: true` on the GTM adapter when every tag in the
container checks consent itself; otherwise a container loaded before opt-in
can fire non-Google tags that set cookies.

## Events

```ts
import { tags } from "@/app/tags";

tags.track("Lead", { form: "contact" });
```

`track` reaches every adapter whose category the visitor granted, and is
dropped, never queued, without consent. Use Meta's standard event names
(`Lead`, `Contact`, `Subscribe`, …) where one fits: anything else goes out as
a custom event.

## Your own banner

`ConsentBanner` takes the site's look from the `--typren-*` style tokens, with
shadcn's as fallback, and offers Accept all, Reject non-essential and
per-category settings with equal weight. To build your own, read and write the
same store:

```tsx
import { useConsent } from "@typren/core/ui/typren-tags";

const { decided, analytics, marketing } = useConsent(tags.consent);
tags.consent.set({ analytics: true, marketing: false });
```

Call `tags.consent.openSettings()` from a footer "Cookie settings" link; the
default banner reopens on it, and a custom one listens for
`tags.consent.openEvent`.

Withdrawing consent stops every future call at once, but a cookie a vendor
already set can't be deleted across domains. Say so in your cookie policy.
