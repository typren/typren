// Visitor consent for third-party tags: one first-party cookie, versioned
// against the site's cookie policy, and the Google Consent Mode v2 signals
// derived from it. Framework-free and SSR-safe.

/** `essential` is always on and is never stored as a choice. */
export type ConsentCategory = "essential" | "analytics" | "marketing";

/** The two categories a visitor decides on. */
export type ConsentPrefs = { analytics: boolean; marketing: boolean };

/** What the cookie holds. */
export type StoredConsent = ConsentPrefs & {
  essential: true;
  /** Policy version the decision was made under. */
  v: string;
  /** Epoch ms the decision was recorded. */
  ts: number;
};

export type ConsentStoreOptions = {
  /** Bump whenever the tags or cookie policy materially change: a decision
   *  recorded under another version reads as unset, so the banner asks again. */
  policyVersion: string;
  /** Defaults to "typren-consent". */
  cookieName?: string;
  /** Defaults to 183 days, the CNIL-recommended ceiling of six months. */
  maxAgeDays?: number;
};

export type ConsentStore = {
  /** The decision, or null when unset, malformed, under a stale policy
   *  version, or on the server. */
  get(): StoredConsent | null;
  /** Record an explicit decision. Call it only from a visitor's action, never
   *  to pre-seed a default. */
  set(prefs: ConsentPrefs): void;
  /** Called after every `set`, from any store with the same cookie name. */
  subscribe(listener: () => void): () => void;
  /** Asks the site's banner to reopen, e.g. from a footer "Cookie settings" link. */
  openSettings(): void;
  /** The window event `openSettings` dispatches; the banner listens for it. */
  openEvent: string;
};

const COOKIE_NAME = /^[A-Za-z0-9_-]+$/;

export function createConsentStore(opts: ConsentStoreOptions): ConsentStore {
  const name = opts.cookieName ?? "typren-consent";
  if (!COOKIE_NAME.test(name)) throw new Error(`Invalid consent cookie name "${name}"`);
  const maxAge = Math.round((opts.maxAgeDays ?? 183) * 24 * 60 * 60);
  // Stores are separate instances in the banner and in the tag loader, so they
  // stay in step through the window, not through a module-level listener set.
  const changeEvent = `${name}:change`;

  function get(): StoredConsent | null {
    if (globalThis.document === undefined) return null;
    const raw = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
    if (!raw) return null;
    try {
      const data = JSON.parse(decodeURIComponent(raw)) as Partial<StoredConsent>;
      if (typeof data.analytics !== "boolean" || typeof data.marketing !== "boolean" || data.v !== opts.policyVersion) {
        return null;
      }
      return {
        essential: true,
        analytics: data.analytics,
        marketing: data.marketing,
        v: data.v,
        ts: typeof data.ts === "number" ? data.ts : 0,
      };
    } catch {
      return null;
    }
  }

  return {
    get,
    set(prefs) {
      if (globalThis.document === undefined) return;
      const value: StoredConsent = { essential: true, ...prefs, v: opts.policyVersion, ts: Date.now() };
      document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}; path=/; max-age=${maxAge}; SameSite=Lax`;
      window.dispatchEvent(new Event(changeEvent));
    },
    subscribe(listener) {
      if (globalThis.window === undefined) return () => {};
      window.addEventListener(changeEvent, listener);
      return () => window.removeEventListener(changeEvent, listener);
    },
    openSettings() {
      if (globalThis.window !== undefined) window.dispatchEvent(new Event(`${name}:open`));
    },
    openEvent: `${name}:open`,
  };
}

// ponytail: IANA timezone under Europe/* (plus Iceland's Atlantic/Reykjavik and
// Cyprus's canonical Asia/Nicosia) is a no-network heuristic that
// over-includes (non-EU Europe, VPNs), which errs strict. Upgrade path: read a
// country the CDN stamps into a first-party cookie (CloudFront-Viewer-Country,
// Cloudflare CF-IPCountry) in preference to the timezone.
const STRICT_NON_EUROPE_ZONES = new Set(["Atlantic/Reykjavik", "Asia/Nicosia"]);

/** Whether the visitor is likely in the EU/EEA/UK, where nothing may load
 *  before opt-in. True on the server and whenever it can't tell. */
export function isStrictConsentRegion(): boolean {
  if (typeof Intl === "undefined") return true;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    return tz.startsWith("Europe/") || STRICT_NON_EUROPE_ZONES.has(tz);
  } catch {
    return true;
  }
}

/** Google Consent Mode v2 signals: analytics → analytics_storage, marketing →
 *  the three ad_* signals. */
export function consentModeSignals(prefs: ConsentPrefs) {
  const g = (ok: boolean) => (ok ? "granted" : "denied");
  return {
    analytics_storage: g(prefs.analytics),
    ad_storage: g(prefs.marketing),
    ad_user_data: g(prefs.marketing),
    ad_personalization: g(prefs.marketing),
  };
}
