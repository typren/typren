"use client";

import Script from "next/script";
import { useEffect, useSyncExternalStore } from "react";
import { consentModeSignals, isStrictConsentRegion, type ConsentPrefs, type ConsentStore } from "../tags/consent";
import type { TagEngine } from "../tags/engine";

/** The decision as a primitive, so useSyncExternalStore's Object.is check is
 *  stable: "" undecided, else analytics then marketing as 0 or 1. */
function snapshotOf(store: ConsentStore): string {
  const c = store.get();
  return c ? `${Number(c.analytics)}${Number(c.marketing)}` : "";
}

/** The visitor's live consent decision, for a custom banner or settings panel.
 *  Undecided on the server and during hydration. */
export function useConsent(store: ConsentStore): ConsentPrefs & { decided: boolean } {
  const key = useSyncExternalStore(store.subscribe, () => snapshotOf(store), () => "");
  return { decided: key !== "", analytics: key[0] === "1", marketing: key[1] === "1" };
}

const noSubscribe = () => () => {};

/**
 * Puts the engine's tags on the page as consent allows. Mount it once in the
 * root layout, from a client module that creates the engine (a server layout
 * can't pass the engine's functions down). Renders nothing on the server, so
 * no tag is ever in the HTML.
 */
export function TyprenTags({ engine }: { engine: TagEngine }) {
  const { decided, analytics, marketing } = useConsent(engine.consent);
  const strict = useSyncExternalStore(noSubscribe, isStrictConsentRegion, () => null);
  const enabled = useSyncExternalStore(noSubscribe, engine.enabled, () => false);

  // Next runs an inline script once per id, so a decision made after the
  // Consent Mode default loaded reaches gtag here instead.
  useEffect(() => {
    if (decided && typeof window.gtag === "function") {
      window.gtag("consent", "update", consentModeSignals({ analytics, marketing }));
    }
  }, [decided, analytics, marketing]);

  if (!enabled || strict === null) return null;
  return engine.scripts(decided ? { analytics, marketing } : null, strict).flatMap((s) => [
    s.inline && (
      <Script key={s.id} id={s.id} strategy="afterInteractive">
        {s.inline}
      </Script>
    ),
    s.src && <Script key={`${s.id}-src`} id={`${s.id}-src`} src={s.src} strategy="afterInteractive" />,
  ]);
}
