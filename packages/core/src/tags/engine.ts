import { consentModeSignals, createConsentStore, type ConsentPrefs, type ConsentStore, type ConsentStoreOptions } from "./consent";
import type { TagAdapter, TagProps, TagScript } from "./adapters";

export type TagEngineOptions = ConsentStoreOptions & {
  adapters: TagAdapter[];
  /** "regional" (default): strict opt-in in the EU/EEA/UK; elsewhere tags
   *  that honour Consent Mode load at once with storage denied until opt-in.
   *  "strict": nothing loads before opt-in, anywhere. */
  consentMode?: "regional" | "strict";
  /** Tags load only on this hostname, so staging, previews and localhost
   *  sharing the bundle never report into production properties. Omit to
   *  load on every host. */
  productionHost?: string;
  /** Kill switch that wins over any consent, e.g. for a preview environment. */
  disabled?: boolean;
};

export type TagEngine = {
  consent: ConsentStore;
  consentMode: "regional" | "strict";
  /** Whether tags may run on this page at all: not disabled, and on the
   *  production host when one is set. Always false on the server. */
  enabled(): boolean;
  /** The scripts to have on the page, in order, for a consent decision and
   *  region. Pure, so a loader re-renders from it on every change. */
  scripts(prefs: ConsentPrefs | null, strict: boolean): TagScript[];
  /** Sends a site event to every tag whose category the visitor granted.
   *  Dropped, not queued, without consent. */
  track(event: string, props?: TagProps): void;
};

export function createTagEngine(opts: TagEngineOptions): TagEngine {
  const consent = createConsentStore(opts);
  const consentMode = opts.consentMode ?? "regional";
  const names = new Set<string>();
  for (const a of opts.adapters) {
    if (names.has(a.name)) throw new Error(`Two tag adapters are named "${a.name}"`);
    names.add(a.name);
  }

  function enabled(): boolean {
    if (opts.disabled || globalThis.window === undefined) return false;
    return !opts.productionHost || window.location.hostname === opts.productionHost;
  }

  return {
    consent,
    consentMode,
    enabled,
    scripts(prefs, strict) {
      const regional = consentMode === "regional" && !strict;
      const active = opts.adapters.filter((a) => prefs?.[a.category] || (regional && a.consentMode));
      if (!regional || !active.some((a) => a.consentMode)) return active.flatMap((a) => a.scripts());
      // Consent Mode needs its default before any Google tag runs.
      const update = prefs ? `gtag('consent','update',${JSON.stringify(consentModeSignals(prefs))});` : "";
      const defaults = { ...consentModeSignals({ analytics: false, marketing: false }), wait_for_update: 500 };
      return [
        {
          id: "typren-consent-mode",
          inline: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',${JSON.stringify(defaults)});${update}`,
        },
        ...active.flatMap((a) => a.scripts()),
      ];
    },
    track(event, props) {
      if (!enabled()) return;
      const prefs = consent.get();
      if (!prefs) return;
      for (const a of opts.adapters) if (prefs[a.category]) a.track?.(event, props);
    },
  };
}
