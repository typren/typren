"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { CmsConfig } from "../types";
import { parseSectionQuery } from "../section-query";
import { isOrigin } from "./preview-bridge.vanilla";

/** The width a section renders at before it is scaled into its tile, and the
 *  tallest stretch of it a tile shows: a desktop's first screen. */
const RENDER = { width: 1280, height: 800 };

/** One tile as the studio posts it: where to draw, in this frame's pixels. */
export type SectionPlace = { key: string; left: number; top: number; width: number; height: number; radius: number; slice?: unknown };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 100_000) : 0);

/** The studio's posted layout, validated. Malformed entries are dropped; a
 *  slice rides along untouched, for the caller to check. */
export function toPlaces(raw: unknown): SectionPlace[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 500).flatMap((p: Record<string, unknown> | null) =>
    p && typeof p === "object" && typeof p.key === "string" && p.key.length <= 64
      ? [{ key: p.key, left: num(p.left), top: num(p.top), width: num(p.width), height: num(p.height), radius: num(p.radius), slice: p.slice }]
      : []
  );
}

// The frame lies over the studio's grid, so only the tiles may paint: the
// site's layout chrome stays in the DOM but hidden (the tiles render inside
// it, so its fonts and variables still reach them), Next's dev badge goes,
// and nothing scrolls.
const STYLE = `
  html,body{background:transparent!important}
  html{overflow:hidden!important}
  body{visibility:hidden}
  nextjs-portal{display:none!important}
  #typren-sections{position:fixed;inset:0;z-index:2147483647;overflow:hidden;visibility:visible;pointer-events:none}
  #typren-sections>div{transition:opacity .2s}
  @media (prefers-reduced-motion:reduce){#typren-sections>div{transition:none}}
`;

/** One section, rendered desktop-wide and scaled into its tile; cropped to a
 *  first screen and centred, like the studio's single-section frame. */
function Placed({ place, children, onReady }: Readonly<{ place: SectionPlace; children: ReactNode; onReady: (key: string) => void }>) {
  const inner = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setMeasured(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = measured > 0;
  useEffect(() => {
    if (shown) onReady(place.key);
  }, [shown, place.key, onReady]);
  const height = Math.min(measured || RENDER.height, RENDER.height);
  const scale = shown ? Math.min(place.width / RENDER.width, place.height / height) : place.width / RENDER.width;
  return (
    <div
      style={{ position: "absolute", left: place.left, top: place.top, width: place.width, height: place.height, overflow: "hidden", borderRadius: place.radius, opacity: shown ? 1 : 0 }}
    >
      <div
        ref={inner}
        data-typren-section={place.key}
        style={{
          position: "absolute",
          width: RENDER.width,
          left: (place.width - RENDER.width * scale) / 2,
          top: shown ? (place.height - height * scale) / 2 : 0,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The section canvas's many-section mode (`?slices=`): one page draws every
 * tile of the studio's Templates grid, so the grid costs one page load
 * instead of one per tile. The studio lays this frame over its grid and
 * posts `{type:"sections", items}`, each item a tile's key, rect and slice;
 * every section renders 1280px wide, scaled into its rect and clipped to its
 * radius. It answers with the keys it has drawn (`ready`), the ones it
 * cannot (`missing`) and its root's `colorScheme`, which the studio copies
 * onto the frame so the browser keeps the frame transparent.
 *
 * `rendered` is the server form: sections rendered on the server from the
 * page's `?slices=` query, by key, so a posted slice is ignored and a key
 * that is not there is missing (the studio then reloads with it). `registry`
 * is the client form: it renders the posted slices themselves, checked like
 * the query (see `parseSectionQuery`), so it never needs a reload.
 *
 * Messages count only from the parent window at `origin`, and posts go only
 * there; without a valid origin, or in a production build, it is inert.
 */
export function MultiSectionCanvas({
  origin,
  rendered,
  registry,
}: Readonly<{ origin?: string; rendered?: Record<string, ReactNode>; registry?: CmsConfig["registry"] }>) {
  const [places, setPlaces] = useState<SectionPlace[]>([]);
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
  const [host, setHost] = useState<HTMLElement | null>(null);
  const open = Boolean(origin && isOrigin(origin)) && process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!open) return;
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.append(style);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== window.parent) return;
      const d = e.data;
      if (d?.__typren === true && d.type === "sections") setPlaces(toPlaces(d.items));
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      style.remove();
    };
  }, [open, origin]);

  const nodes = useMemo(() => {
    const out = new Map<string, ReactNode>();
    for (const p of places) {
      if (out.has(p.key)) continue;
      if (rendered) {
        if (Object.hasOwn(rendered, p.key)) out.set(p.key, rendered[p.key]);
        continue;
      }
      if (!registry) continue;
      let slice = null;
      try {
        slice = parseSectionQuery(JSON.stringify(p.slice), (k) => Object.hasOwn(registry, k));
      } catch {
        // A cyclic or BigInt value: not a slice.
      }
      const Component = slice && (registry[slice.slice] as ComponentType<Record<string, unknown>>);
      if (Component) out.set(p.key, <Component {...slice} />);
    }
    return out;
  }, [places, rendered, registry]);

  const markReady = useCallback((key: string) => setReady((r) => (r.has(key) ? r : new Set(r).add(key))), []);

  useEffect(() => {
    if (!host || !origin) return;
    window.parent.postMessage(
      {
        __typren: true,
        type: "sections",
        ready: [...ready].filter((k) => nodes.has(k)),
        missing: [...new Set(places.filter((p) => !nodes.has(p.key)).map((p) => p.key))],
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      },
      origin
    );
  }, [host, origin, places, nodes, ready]);

  if (!open) return null;
  // Keyed by content, so a tile that only moves keeps its render.
  const seen = new Map<string, number>();
  return (
    <div id="typren-sections" aria-hidden ref={setHost}>
      {places.map((p) => {
        const n = (seen.get(p.key) ?? 0) + 1;
        seen.set(p.key, n);
        return nodes.has(p.key) ? (
          <Placed key={`${p.key}#${n}`} place={p} onReady={markReady}>
            {nodes.get(p.key)}
          </Placed>
        ) : null;
      })}
    </div>
  );
}
