// Tag adapters: one per vendor, each describing the scripts it injects and how
// it forwards a site event. The engine (./engine) decides when each may load.

export type TagCategory = "analytics" | "marketing";

export type TagProps = Record<string, string | number | boolean>;

/** One script to inject: inline bootstrap code, an external `src`, or both. */
export type TagScript = { id: string; inline?: string; src?: string };

export type TagAdapter = {
  name: string;
  /** The consent category that must be granted before this tag loads. */
  category: TagCategory;
  /** The tag honours Google Consent Mode v2, so in "regional" mode it may
   *  load before opt-in outside the EU/EEA/UK, with storage denied. */
  consentMode?: boolean;
  scripts(): TagScript[];
  /** Forwards a site event. Runs in the browser, after `scripts()` loaded. */
  track?(event: string, props?: TagProps): void;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    _hsq?: unknown[];
    lintrk?: (...args: unknown[]) => void;
  }
}

// IDs are interpolated into inline script source, so they are validated to
// their vendor's shape rather than trusted.
function checked(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new Error(`Invalid ${label} "${value}"`);
  return value;
}

export type GtmAdapterOptions = {
  /** e.g. "GTM-ABC123". */
  containerId: string;
  /** Defaults to "marketing": a container can fire any vendor's tags. */
  category?: TagCategory;
  /** Load before opt-in under Consent Mode. Only safe when every tag in the
   *  container checks consent itself; defaults to false. */
  consentMode?: boolean;
};

export function createGtmAdapter(opts: GtmAdapterOptions): TagAdapter {
  const id = checked(opts.containerId, /^GTM-[A-Z0-9]+$/, "GTM container ID");
  return {
    name: "gtm",
    category: opts.category ?? "marketing",
    consentMode: opts.consentMode ?? false,
    scripts: () => [
      {
        id: "typren-gtm",
        inline: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`,
      },
    ],
    track(event, props) {
      (window.dataLayer ??= []).push({ event, ...props });
    },
  };
}

export type Ga4AdapterOptions = { /** e.g. "G-ABC123". */ measurementId: string };

export function createGa4Adapter(opts: Ga4AdapterOptions): TagAdapter {
  const id = checked(opts.measurementId, /^G-[A-Z0-9]+$/, "GA4 measurement ID");
  return {
    name: "ga4",
    category: "analytics",
    consentMode: true,
    scripts: () => [
      {
        id: "typren-ga4",
        inline: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});`,
        src: `https://www.googletagmanager.com/gtag/js?id=${id}`,
      },
    ],
    track(event, props) {
      window.gtag?.("event", event, props);
    },
  };
}

// Meta's standard events feed ad optimisation; anything else is sent as a
// custom event, which Meta otherwise drops from standard reporting.
const META_STANDARD_EVENTS = new Set([
  "AddPaymentInfo",
  "AddToCart",
  "AddToWishlist",
  "CompleteRegistration",
  "Contact",
  "CustomizeProduct",
  "Donate",
  "FindLocation",
  "InitiateCheckout",
  "Lead",
  "Purchase",
  "Schedule",
  "Search",
  "StartTrial",
  "SubmitApplication",
  "Subscribe",
  "ViewContent",
]);

export type MetaPixelAdapterOptions = { /** The numeric pixel ID. */ pixelId: string };

export function createMetaPixelAdapter(opts: MetaPixelAdapterOptions): TagAdapter {
  const id = checked(opts.pixelId, /^\d+$/, "Meta pixel ID");
  return {
    name: "meta-pixel",
    category: "marketing",
    scripts: () => [
      {
        id: "typren-meta-pixel",
        inline: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`,
      },
    ],
    track(event, props) {
      window.fbq?.(META_STANDARD_EVENTS.has(event) ? "track" : "trackCustom", event, props);
    },
  };
}

export type HubSpotAdapterOptions = {
  /** The numeric Hub ID. */
  portalId: string;
  /** "eu1" for a portal hosted in HubSpot's EU data centre. */
  region?: "eu1";
};

/** HubSpot tracking: page views, form and chat attribution, and custom
 *  behavioral events (Marketing Hub Enterprise; ignored on lower tiers). */
export function createHubSpotAdapter(opts: HubSpotAdapterOptions): TagAdapter {
  const id = checked(opts.portalId, /^\d+$/, "HubSpot portal ID");
  const host = opts.region ? `js-${opts.region}.hs-scripts.com` : "js.hs-scripts.com";
  return {
    name: "hubspot",
    category: "marketing",
    scripts: () => [{ id: "hs-script-loader", src: `https://${host}/${id}.js` }],
    track(event, props) {
      (window._hsq ??= []).push(["trackCustomBehavioralEvent", { name: event, properties: props ?? {} }]);
    },
  };
}

export type LinkedInInsightAdapterOptions = {
  /** The numeric partner ID from Campaign Manager. */
  partnerId: string;
  /** Site event name → LinkedIn conversion ID. LinkedIn counts conversions
   *  by ID only, so an event with no entry here is not sent. */
  conversions?: Record<string, number>;
};

export function createLinkedInInsightAdapter(opts: LinkedInInsightAdapterOptions): TagAdapter {
  const id = checked(opts.partnerId, /^\d+$/, "LinkedIn partner ID");
  const conversions = opts.conversions ?? {};
  return {
    name: "linkedin-insight",
    category: "marketing",
    scripts: () => [
      {
        id: "typren-linkedin-insight",
        inline: `window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push('${id}');(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}})(window.lintrk);`,
        src: "https://snap.licdn.com/li.lms-analytics/insight.min.js",
      },
    ],
    track(event) {
      const conversion = Object.hasOwn(conversions, event) ? conversions[event] : undefined;
      if (conversion !== undefined) window.lintrk?.("track", { conversion_id: conversion });
    },
  };
}

export type ScriptAdapterOptions = {
  /** Unique per site; also the script element's id. */
  name: string;
  /** An https URL. */
  src: string;
  category: TagCategory;
};

/** Any vendor loaded from one script URL with no event API of its own, e.g.
 *  Hotjar or Microsoft Clarity. */
export function createScriptAdapter(opts: ScriptAdapterOptions): TagAdapter {
  const name = checked(opts.name, /^[a-z0-9-]+$/, "script adapter name");
  if (new URL(opts.src).protocol !== "https:") throw new Error(`Script adapter "${name}" needs an https src`);
  return { name, category: opts.category, scripts: () => [{ id: `typren-${name}`, src: opts.src }] };
}
