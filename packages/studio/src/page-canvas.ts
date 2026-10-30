"use client";

import { useEffect, useRef, useState } from "react";
import type { Slice } from "@typren/core";
import type { CanvasOp } from "@typren/core/ui/canvas";
import { fromFrame, postToFrame } from "./device-preview";

/** How long the canvas has to say `hello` before the studio frames the real
 *  route instead (an old core, a site without the route, a crashed page). */
export const HELLO_TIMEOUT = 3000;

/** A slice with the studio's per-session key. Keys are never stored. */
export type Keyed = { key: string; slice: Slice };

/**
 * Keys for `slices`, carried over from `prev`: a slice object the studio
 * kept (a reorder, an insert elsewhere) keeps its key by identity; one
 * replaced at the same position (a prop edit) takes over that position's
 * key, so the canvas updates it in place; anything else gets `fresh()`.
 */
export function keySlices(prev: readonly Keyed[], slices: readonly Slice[], fresh: () => string): Keyed[] {
  const byRef = new Map<Slice, string>();
  for (const e of prev) if (!byRef.has(e.slice)) byRef.set(e.slice, e.key);
  const used = new Set<string>();
  const keys: (string | undefined)[] = slices.map((s) => {
    const k = byRef.get(s);
    if (k === undefined || used.has(k)) return undefined;
    used.add(k);
    return k;
  });
  return slices.map((slice, i) => {
    let key = keys[i];
    if (key === undefined) {
      const at = prev[i]?.key;
      key = at !== undefined && !used.has(at) ? at : fresh();
      used.add(key);
    }
    return { key, slice };
  });
}

/** The `patch` ops that turn `prev` into `next`, applied in order: removes,
 *  then each position's move or insert, then prop changes. */
export function diffSlices(prev: readonly Keyed[], next: readonly Keyed[]): CanvasOp[] {
  const want = new Set(next.map((e) => e.key));
  const ops: CanvasOp[] = [];
  const order = prev.map((e) => e.key).filter((k) => want.has(k) || (ops.push({ op: "remove", key: k }), false));
  next.forEach(({ key, slice }, i) => {
    if (order[i] === key) return;
    const from = order.indexOf(key);
    if (from >= 0) {
      order.splice(from, 1);
      ops.push({ op: "move", key, to: i });
    } else ops.push({ op: "insert", at: i, key, slice });
    order.splice(i, 0, key);
  });
  const before = new Map(prev.map((e) => [e.key, e.slice]));
  for (const { key, slice } of next) if (before.has(key) && before.get(key) !== slice) ops.push({ op: "set", key, slice });
  return ops;
}

/** The page canvas's URL: the section route in page mode, the session
 *  nonce in the fragment (never sent to the server). */
export function canvasSrc(url: string, nonce: string): string {
  const u = new URL(url, window.location.origin);
  u.search = u.search ? `${u.search}&page` : "?page";
  u.hash = `typren=${nonce}`;
  return u.href;
}

/** A path under one of `prefixes`, by whole segment ("/blog" covers
 *  "/blog" and "/blog/post", not "/blogger"). "/" is the home page alone:
 *  every page under it would leave the canvas nothing to do. */
export const underPrefix = (path: string, prefixes: readonly string[] = []) =>
  prefixes.some((p) => {
    const base = p.replace(/\/+$/, "");
    return base ? path === base || path.startsWith(`${base}/`) : path === "/";
  });

let counter = 0;
const newKey = () => `s${(counter++).toString(36)}`;

/**
 * The studio side of the persistent page canvas (docs/canvas-renderer.md):
 * mounts nothing itself, but gives the shell the canvas frame's `src`, ref
 * and nonce and waits for its `hello`; `useCanvasDocument` then keeps it
 * showing the page. `ready` turns true once the canvas has painted the
 * latest revision. `keep` turns false once the canvas answered that it
 * cannot render, so the shell drops its frame; one that lets
 * `HELLO_TIMEOUT` pass stays not ready but kept, since a dev server's first
 * compile of the route can take longer, and a late hello still upgrades it.
 *
 * `mounted` is whether the shell renders the frame now; each mount waits
 * for its own hello.
 */
export function usePageCanvas({ url, mounted }: Readonly<{ url?: string; mounted: boolean }>) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // getRandomValues, unlike randomUUID, also works outside a secure context.
  const [nonce] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
  const [state, setState] = useState<"waiting" | "connected" | "late" | "unavailable">("waiting");
  const [painted, setPainted] = useState(false);
  // Moves to send the whole document again (hello, resync).
  const [fresh, setFresh] = useState(0);
  const sent = useRef<{ slug?: string | null; locale?: string; entries: Keyed[]; rev: number } | null>(null);
  const rev = useRef(0);
  const live = Boolean(url) && mounted;

  useEffect(() => {
    if (!live) return;
    setState("waiting");
    setPainted(false);
    sent.current = null;
    const onMessage = (e: MessageEvent) => {
      if (!fromFrame(e, frameRef.current) || e.data?.__typren !== true) return;
      const d = e.data;
      if (d.type === "hello") {
        const ok = Number.isInteger(d.protocol) && d.protocol >= 1 && Array.isArray(d.renderers) && d.renderers.length > 0;
        setState(ok ? "connected" : "unavailable");
        sent.current = null;
        setFresh((n) => n + 1);
      }
      if (d.type === "resync") {
        sent.current = null;
        setFresh((n) => n + 1);
      }
      if (d.type === "rendered" && d.rev === rev.current) setPainted(true);
    };
    window.addEventListener("message", onMessage);
    const t = setTimeout(() => setState((s) => (s === "waiting" ? "late" : s)), HELLO_TIMEOUT);
    return () => {
      clearTimeout(t);
      window.removeEventListener("message", onMessage);
    };
  }, [live]);

  const src = url && typeof window !== "undefined" ? canvasSrc(url, nonce) : undefined;
  return {
    frameRef,
    src,
    nonce,
    ready: state === "connected" && painted,
    keep: Boolean(src) && state !== "unavailable",
    /** For `useCanvasDocument`. */
    sync: { connected: state === "connected", fresh, sent, rev },
  };
}

/** Keeps the canvas showing `slices`: a `document` when the page or locale
 *  changes or the canvas asks for one (hello, resync), else a `patch` per
 *  change. No `slices` sends nothing (a page still loading, or one that
 *  previews on its real route). */
export function useCanvasDocument(
  canvas: ReturnType<typeof usePageCanvas>,
  { slug, locale, slices }: Readonly<{ slug?: string | null; locale?: string; slices?: readonly Slice[] }>,
) {
  const { connected, fresh, sent, rev } = canvas.sync;
  const frameRef = canvas.frameRef;
  useEffect(() => {
    if (!connected || !slices) return;
    const last = sent.current;
    const same = last && last.slug === slug && last.locale === locale;
    const entries = keySlices(same ? last.entries : [], slices, newKey);
    if (same) {
      const ops = diffSlices(last.entries, entries);
      if (!ops.length) return;
      rev.current++;
      postToFrame(frameRef.current, { __typren: true, type: "patch", rev: rev.current, base: last.rev, ops });
    } else {
      rev.current++;
      postToFrame(frameRef.current, { __typren: true, type: "document", rev: rev.current, page: slug, locale, slices: entries });
    }
    sent.current = { slug, locale, entries, rev: rev.current };
  }, [connected, slices, slug, locale, fresh, sent, rev, frameRef]);
}
