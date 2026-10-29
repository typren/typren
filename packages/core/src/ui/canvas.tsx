"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import type { CmsConfig, Slice } from "../types";
import { DOCUMENT_LIMITS, parseSectionDocument, parseSectionQuery, type KeyedSlice } from "../section-query";
import { isOrigin } from "./preview-bridge.vanilla";
import { MultiSectionCanvas } from "./section-canvas-multi";
import { StudioBridge } from "./studio-bridge";

/** The canvas protocol this core speaks (see docs/canvas-renderer.md). */
export const CANVAS_PROTOCOL = 1;

/** One section a renderer has mounted. */
export interface MountedSection {
  update(props: Record<string, unknown>): void;
  unmount(): void;
}

/** Mounts one framework component into one element of the page canvas. A
 *  section that throws should dispatch a bubbling `typren:error` event from
 *  its element, which the canvas reports to the studio. */
export interface RendererAdapter<C = unknown> {
  readonly name: string;
  mount(el: HTMLElement, component: C, props: Record<string, unknown>): MountedSection;
  /** Rendered once inside the canvas's own React tree, for a renderer whose
   *  sections live there (the React renderer's portals). */
  readonly Outlet?: ComponentType;
}

/** A `patch` operation, by the studio's per-session slice key. */
export type CanvasOp =
  | { op: "set"; key: string; slice: unknown }
  | { op: "insert"; at: number; key: string; slice: unknown }
  | { op: "remove"; key: string }
  | { op: "move"; key: string; to: number };

type Post = (message: Record<string, unknown>) => void;
type Entry = { key: string; el: HTMLElement; slice: Slice | null; mounted: MountedSection | null };

const rev = (v: unknown) => (Number.isSafeInteger(v) ? (v as number) : null);
const at = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);

/** `ops` applied in order to `list`, or null when one does not fit it. */
function applyOps(list: KeyedSlice[], raw: unknown, known: (k: string) => boolean): KeyedSlice[] | null {
  if (!Array.isArray(raw) || raw.length > DOCUMENT_LIMITS.slices) return null;
  if (!raw.every((o) => typeof o === "object" && o !== null)) return null;
  const ops = raw as Record<string, unknown>[];
  // The posted slices pass the document check together, so one budget caps the patch.
  const posted = ops.filter((o) => o?.op === "set" || o?.op === "insert");
  const clean = parseSectionDocument(posted.map((o) => ({ key: o.key, slice: o.slice })), known);
  if (!clean) return null;
  const slices = new Map(clean.map((e) => [e.key, e.slice]));
  const next = [...list];
  const find = (key: unknown) => next.findIndex((e) => e.key === key);
  for (const o of ops) {
    if (o.op === "set" || o.op === "remove" || o.op === "move") {
      const i = find(o.key);
      if (i < 0) return null;
      if (o.op === "set") next[i] = { key: o.key as string, slice: slices.get(o.key as string)! };
      else {
        const [moved] = next.splice(i, 1);
        if (o.op === "move") {
          const to = at(o.to, next.length);
          if (to === null) return null;
          next.splice(to, 0, moved!);
        }
      }
    } else if (o.op === "insert") {
      const i = at(o.at, next.length);
      if (i === null || find(o.key) >= 0) return null;
      next.splice(i, 0, { key: o.key as string, slice: slices.get(o.key as string)! });
    } else return null;
  }
  return next.length > DOCUMENT_LIMITS.slices ? null : next;
}

/**
 * The page canvas's state machine, framework-free: it keeps one element per
 * slice under `root`, in document order, each wrapped as the preview bridge
 * expects (`data-typren-index`, plus `data-typren-key`), and has `renderer`
 * mount, update or unmount the registry's component in it. A reorder moves
 * the element, so the mounted section survives it.
 *
 * `receive` takes the studio's messages, already checked for origin and
 * nonce: `document` replaces the page, `patch` applies to the current `rev`
 * only and otherwise asks for a `resync`. Each answer goes through `post`:
 * `rendered { rev, ms }` on the next animation frame, `missing { keys }` for
 * slices this site cannot render, `error { key }` for a section that threw.
 */
export function createCanvasSession<C>({
  renderer,
  registry,
  root,
  post,
}: Readonly<{ renderer: RendererAdapter<C>; registry: Record<string, C>; root: HTMLElement; post: Post }>) {
  const known = (k: string) => Object.hasOwn(registry, k);
  let current: number | null = null;
  let entries: Entry[] = [];
  let frame = 0;

  const reconcile = (next: KeyedSlice[]) => {
    const old = new Map(entries.map((e) => [e.key, e]));
    entries = next.map(({ key, slice }) => {
      let e = old.get(key);
      old.delete(key);
      if (!e) {
        const el = document.createElement("div");
        el.setAttribute("data-typren-key", key);
        e = { key, el, slice: null, mounted: null };
      }
      if (e.slice?.slice !== slice?.slice) {
        e.mounted?.unmount();
        e.mounted = slice ? renderer.mount(e.el, registry[slice.slice]!, slice) : null;
      } else if (slice && slice !== e.slice) e.mounted?.update(slice);
      e.slice = slice;
      return e;
    });
    for (const e of old.values()) {
      e.mounted?.unmount();
      e.el.remove();
    }
    entries.forEach((e, i) => {
      if (root.children[i] !== e.el) root.insertBefore(e.el, root.children[i] ?? null);
      e.el.setAttribute("data-typren-index", String(i));
    });
    const missing = entries.filter((e) => !e.slice).map((e) => e.key);
    if (missing.length) post({ type: "missing", keys: missing });
  };

  const rendered = (start: number) => {
    const at = current;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => post({ type: "rendered", rev: at, ms: Math.round((performance.now() - start) * 10) / 10 }));
  };

  const onError = (e: Event) => {
    const key = (e.target as Element | null)?.closest?.("[data-typren-key]")?.getAttribute("data-typren-key");
    if (key) post({ type: "error", key });
  };
  root.addEventListener("typren:error", onError);

  return {
    /** Ready: tells the studio this canvas's protocol and renderer. */
    hello: () => post({ type: "hello", protocol: CANVAS_PROTOCOL, renderers: [renderer.name], server: false }),
    receive(d: Record<string, unknown>) {
      const start = performance.now();
      const to = rev(d.rev);
      if (to === null) return;
      if (d.type === "document") {
        const slices = parseSectionDocument(d.slices, known);
        if (!slices) return;
        reconcile(slices);
      } else if (d.type === "patch") {
        const next = current !== null && d.base === current ? applyOps(entries, d.ops, known) : null;
        if (!next) return post({ type: "resync", rev: current });
        reconcile(next);
      } else return;
      current = to;
      rendered(start);
    },
    destroy() {
      cancelAnimationFrame(frame);
      root.removeEventListener("typren:error", onError);
      for (const e of entries) e.mounted?.unmount();
      entries = [];
    },
  };
}

/** The studio's session nonce from the frame URL's fragment
 *  (`#typren=<nonce>`), or null. */
export function readNonce(hash: string): string | null {
  const nonce = new URLSearchParams(hash.replace(/^#/, "")).get("typren");
  return nonce && /^[\w-]{16,128}$/.test(nonce) ? nonce : null;
}

/** Posts to the studio, signed with the session nonce. */
const poster = (origin: string, nonce: string): Post => (m) => window.parent.postMessage({ __typren: true, ...m, nonce }, origin);

/** Page mode on a canvas with no client renderer (the server form of
 *  `createSectionCanvas`): says so at once, so the studio falls back to the
 *  real route without waiting out its timer. */
export function CanvasUnavailable({ origin }: Readonly<{ origin?: string }>) {
  useEffect(() => {
    const nonce = readNonce(window.location.hash);
    if (!origin || !isOrigin(origin) || !nonce || process.env.NODE_ENV === "production") return;
    poster(origin, nonce)({ type: "hello", protocol: CANVAS_PROTOCOL, renderers: [], server: false });
  }, [origin]);
  return null;
}

/** The page canvas: an empty element the session fills, the renderer's
 *  outlet and the preview bridge, all speaking with the session nonce. */
function PageCanvas<C>({ origin, nonce, renderer, registry }: Readonly<{ origin: string; nonce: string; renderer: RendererAdapter<C>; registry: Record<string, C> }>) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const post = poster(origin, nonce);
    const session = createCanvasSession({ renderer, registry, root: root.current!, post });
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== window.parent) return;
      const d = e.data;
      if (d?.__typren === true && d.nonce === nonce) session.receive(d);
    };
    window.addEventListener("message", onMessage);
    session.hello();
    return () => {
      window.removeEventListener("message", onMessage);
      session.destroy();
    };
  }, [origin, nonce, renderer, registry]);
  const Outlet = renderer.Outlet;
  return (
    <>
      <div ref={root} data-typren-canvas="" />
      {Outlet && <Outlet />}
      <StudioBridge origin={origin} nonce={nonce} />
    </>
  );
}

type Mode = { mode: "page"; nonce: string | null } | { mode: "many" } | { mode: "one"; slice: Slice | null };

/**
 * The section canvas in the browser, with a renderer for page mode. Mount
 * the result where the site mounts its section canvas today, passed to
 * `createSectionCanvas`, which keeps the server-side gate:
 *
 * - `?page` (with the studio's nonce in the fragment): the persistent page
 *   canvas. The studio posts the page as a `document` and its edits as
 *   `patch`es; every slice renders here, in order, under the root layout.
 * - `?slices=`: the Templates grid (see `MultiSectionCanvas`).
 * - `?slice=`: one slice, as `createClientSectionCanvas` always did.
 *
 * ponytail: the one and many modes render registry entries as React
 * components whatever the renderer; non-React renderers (phase 4) take
 * them over when they land.
 *
 * Inert outside the studio: it reads its URL only outside a production
 * build and with a valid studio `origin`, which the server wrapper passes
 * only while `typren studio` previews.
 */
export function createCanvas<C>({ renderer, registry }: Readonly<{ renderer: RendererAdapter<C>; registry: Record<string, C> }>) {
  const known = (k: string) => Object.hasOwn(registry, k);
  return function Canvas({ origin }: Readonly<{ origin?: string }>) {
    // Unknown until the URL is read, so no mode starts on a guess.
    const [mode, setMode] = useState<Mode>();
    const open = Boolean(origin && isOrigin(origin)) && process.env.NODE_ENV !== "production";
    useEffect(() => {
      if (!open) return;
      const query = new URLSearchParams(window.location.search);
      if (query.has("page")) setMode({ mode: "page", nonce: readNonce(window.location.hash) });
      else if (query.has("slices")) setMode({ mode: "many" });
      else setMode({ mode: "one", slice: parseSectionQuery(query.get("slice"), known) });
    }, [open]);
    if (!open || !mode) return null;
    if (mode.mode === "page")
      return mode.nonce ? <PageCanvas origin={origin!} nonce={mode.nonce} renderer={renderer} registry={registry} /> : null;
    if (mode.mode === "many") return <MultiSectionCanvas origin={origin} registry={registry as unknown as CmsConfig["registry"]} />;
    const Component = mode.slice && (registry[mode.slice.slice] as ComponentType<Record<string, unknown>>);
    return (
      <>
        {Component && (
          <div data-typren-index={0}>
            <Component {...mode.slice} />
          </div>
        )}
        <StudioBridge origin={origin} />
      </>
    );
  };
}
