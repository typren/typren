"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { ConsentPrefs, ConsentStore } from "../tags/consent";
import { useConsent } from "./typren-tags";

export type ConsentBannerProps = {
  store: ConsentStore;
  /** Link to the site's cookie policy. */
  policyHref?: string;
  heading?: ReactNode;
  body?: ReactNode;
};

const noSubscribe = () => () => {};

const NONE: ConsentPrefs = { analytics: false, marketing: false };
const ALL: ConsentPrefs = { analytics: true, marketing: true };

// Site tokens from TyprenStyle, falling back to shadcn's, so the banner takes
// the site's own look without a stylesheet of its own.
const panel: CSSProperties = {
  position: "fixed",
  insetInline: "1rem",
  bottom: "1rem",
  zIndex: 50,
  maxWidth: "48rem",
  marginInline: "auto",
  padding: "1.5rem",
  borderRadius: "var(--typren-radius, var(--radius, 0.75rem))",
  border: "1px solid var(--typren-muted, var(--border, #e5e5e5))",
  background: "var(--typren-bg, var(--background, #fff))",
  color: "var(--typren-fg, var(--foreground, #111))",
  fontFamily: "var(--typren-font-body, inherit)",
  boxShadow: "0 10px 30px rgb(0 0 0 / 0.15)",
};
const button: CSSProperties = {
  minHeight: "2.5rem",
  padding: "0 1.25rem",
  borderRadius: "var(--typren-radius, var(--radius, 0.5rem))",
  border: "1px solid var(--typren-muted, var(--border, #d4d4d4))",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};
const primary: CSSProperties = {
  ...button,
  borderColor: "transparent",
  background: "var(--typren-primary, var(--primary, #111))",
  color: "var(--typren-bg, var(--primary-foreground, #fff))",
};

/**
 * A default consent banner: Accept all, Reject non-essential, or per-category
 * settings. Shows until the visitor decides, and again whenever
 * `store.openSettings()` is called. Escape never counts as a decision. Sites
 * that want their own build it on `useConsent` and the same store instead.
 */
export function ConsentBanner({
  store,
  policyHref,
  heading = "We use cookies",
  body = "Essential cookies run this site. With your permission we also use analytics and marketing cookies to understand usage and measure campaigns.",
}: ConsentBannerProps) {
  const { decided, analytics, marketing } = useConsent(store);
  // The server can't read the cookie, so it renders nothing rather than a
  // banner a returning visitor would see flash and vanish on hydration.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [reopened, setReopened] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [prefs, setPrefs] = useState<ConsentPrefs>(NONE);
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const visible = hydrated && (!decided || reopened);

  useEffect(() => {
    function open() {
      const current = store.get();
      setPrefs(current ? { analytics: current.analytics, marketing: current.marketing } : NONE);
      setReopened(true);
      setExpanded(true);
    }
    window.addEventListener(store.openEvent, open);
    return () => window.removeEventListener(store.openEvent, open);
  }, [store]);

  useEffect(() => {
    if (visible) ref.current?.focus();
  }, [visible]);

  if (!visible) return null;

  function decide(next: ConsentPrefs) {
    store.set(next);
    setReopened(false);
    setExpanded(false);
  }

  const toggle = (key: keyof ConsentPrefs, label: string, description: string) => (
    <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={prefs[key]}
        onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
        style={{ marginTop: "0.2rem", accentColor: "var(--typren-primary, var(--primary))" }}
      />
      <span>
        <strong style={{ display: "block", fontSize: "0.875rem" }}>{label}</strong>
        <span style={{ fontSize: "0.8125rem", opacity: 0.75 }}>{description}</span>
      </span>
    </label>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
      style={panel}
      data-typren-consent=""
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: "1.125rem" }}>
          {heading}
        </h2>
        {decided && reopened && (
          <button type="button" aria-label="Close cookie settings" onClick={() => setReopened(false)} style={{ ...button, border: "none", minHeight: 0, padding: "0.25rem" }}>
            ×
          </button>
        )}
      </div>
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem" }}>
        {body}
        {policyHref && (
          <>
            {" "}
            <a href={policyHref} style={{ color: "inherit", textDecoration: "underline" }}>
              Cookie policy
            </a>
          </>
        )}
      </p>
      {expanded && (
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          <label style={{ display: "flex", gap: "0.75rem", opacity: 0.7 }}>
            <input type="checkbox" checked disabled style={{ marginTop: "0.2rem" }} />
            <span>
              <strong style={{ display: "block", fontSize: "0.875rem" }}>Essential (always on)</strong>
              <span style={{ fontSize: "0.8125rem" }}>Required for the site to work.</span>
            </span>
          </label>
          {toggle("analytics", "Analytics", "Helps us understand how visitors use the site.")}
          {toggle("marketing", "Marketing", "Measures and personalises our campaigns.")}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.25rem" }}>
        <button type="button" style={button} onClick={() => decide(NONE)}>
          Reject non-essential
        </button>
        <button type="button" style={button} onClick={() => decide(ALL)}>
          Accept all
        </button>
        {expanded ? (
          <button type="button" style={primary} onClick={() => decide(prefs)}>
            Save preferences
          </button>
        ) : (
          <button
            type="button"
            style={{ ...button, border: "none", textDecoration: "underline" }}
            onClick={() => {
              setPrefs({ analytics, marketing });
              setExpanded(true);
            }}
          >
            Cookie settings
          </button>
        )}
      </div>
    </div>
  );
}
