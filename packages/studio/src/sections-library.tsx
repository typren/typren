"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LayoutPanelTop } from "lucide-react";
import { BUILT_IN_FOLDER, type PageContent, type PageInfo, type SavedSlice, type Slice, type SliceSchema } from "@typren/core";
import type { AssetView } from "./asset-browser";
import { LibraryBrowser, LibraryEmpty } from "./library-browser";
import { Lightbox } from "./asset-viewer";
import { toRects } from "./canvas-overlay";
import { titleCase } from "./collection-list";
import { FieldForm } from "./field-form";
import { fromFrame, postToFrame, sandboxFor } from "./device-preview";
import { formatDate } from "./format";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { useConfirm } from "./primitives/confirm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./primitives/select";
import type { TyprenStudioHost } from "./types";

/** One tile: a saved slice, or a slice type's defaults as a built-in. */
export type LibraryEntry = { id: string; name: string; slice: Slice; savedAt?: string; folder?: string };

/** Saved slices first, then every registered slice type as a built-in
 *  starting point (its `defaults`) in the Built-in folder, so the library is
 *  never empty and a type can be dressed up here before it goes on a page. */
export function libraryEntries(
  saved: SavedSlice[],
  sliceNames: string[],
  defaults: Record<string, Record<string, unknown>>
): LibraryEntry[] {
  return [
    ...saved,
    ...sliceNames.map((n) => ({ id: `builtin:${n}`, name: titleCase(n), slice: { ...defaults[n], slice: n }, folder: BUILT_IN_FOLDER })),
  ];
}

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && !/^(\/|https?:)/.test(v);

/**
 * A slice drawn as a schematic card: its type, its first texts as a heading
 * and lines (markdown emphasis stripped), and a bar per remaining field.
 * The placeholder while a render loads, and all a site without the section
 * route ever shows.
 */
export function SliceSketch({ slice, schema, large }: Readonly<{ slice: Slice; schema?: SliceSchema; large?: boolean }>) {
  const fields = Object.entries(slice).filter(([k]) => k !== "slice" && k !== "label");
  const texts = fields.filter(([k, v]) => isText(v) && !["image", "media", "icon", "color"].includes(schema?.[k]?.type ?? "")).map(([, v]) => String(v).replaceAll("**", ""));
  const bars = Math.min(3, Math.max(0, fields.length - texts.length));
  return (
    <div
      onClick={large ? (e) => e.stopPropagation() : undefined}
      className={cn(
        "flex w-full flex-col gap-1.5 overflow-hidden rounded-[var(--typren-radius-control)] bg-[var(--typren-card-bg)] text-left shadow-sm ring-1 ring-[var(--typren-stroke-card)]",
        large ? "aspect-[16/9] max-h-full max-w-3xl gap-3 bg-[var(--typren-card)] p-10" : "aspect-[4/3] p-3"
      )}
    >
      <span className={cn("font-mono uppercase tracking-wide text-[var(--typren-muted-fg)]", large ? "text-xs" : "text-[10px]")}>
        {slice.slice}
      </span>
      {texts[0] && <span className={cn("line-clamp-2 font-semibold text-[var(--typren-fg)]", large ? "text-3xl" : "text-sm leading-tight")}>{texts[0]}</span>}
      {texts.slice(1, 3).map((t, i) => (
        <span key={i} className={cn("line-clamp-2 text-[var(--typren-muted-fg)]", large ? "text-base" : "text-[11px] leading-snug")}>
          {t}
        </span>
      ))}
      {Array.from({ length: bars }, (_, i) => (
        <span key={`bar${i}`} aria-hidden className={cn("rounded-full bg-[var(--typren-muted)]", large ? "h-3" : "h-1.5")} style={{ width: `${80 - i * 20}%` }} />
      ))}
    </div>
  );
}

/** Frames loading at once. A dev server compiles and serves them one request
 *  at a time anyway, so more only delay the first tile. */
const MAX_FRAMES = 4;
const SLOT_MS = 15_000;
let loading = 0;
const waiting: Array<() => void> = [];
const drain = () => {
  while (loading < MAX_FRAMES && waiting.length) waiting.shift()!();
};

/** Runs `go` when a loading slot is free (first come, first served), and
 *  returns the release: it frees the slot, or leaves the queue if `go` has not
 *  run. Safe to call more than once. */
export function acquireFrame(go: () => void): () => void {
  let state: "queued" | "running" | "done" = "queued";
  const start = () => {
    state = "running";
    loading++;
    go();
  };
  waiting.push(start);
  drain();
  return () => {
    if (state === "queued") waiting.splice(waiting.indexOf(start), 1);
    else if (state === "running") {
      loading--;
      drain();
    }
    state = "done";
  };
}

/** The viewport the site renders a section in: desktop width, first screen. */
const RENDER = { width: 1280, height: 800 };
const noSubscribe = () => () => {};
const sectionSrc = (base: string, json: string) => `${base}${base.includes("?") ? "&" : "?"}slice=${encodeURIComponent(json)}`;

/**
 * A slice as the site renders it: `base` (the site's section route, see
 * `TyprenStudioHost.sectionPreviewUrl`) loads with the slice's props in
 * `?slice=`, in a desktop-sized frame scaled down to fit this box and cropped
 * to the slice. The route's SliceZone mounts the preview bridge, whose
 * `rects` post says where the slice sits; until one arrives the box shows
 * the sketch, so a site without the route degrades to it, never a 404.
 *
 * ponytail: the props ride in the URL, so a frame reloads per edit (after a
 * pause in typing) and a very large slice could pass a URL length limit.
 * Posting props to a live frame is the upgrade if either shows.
 */
function SliceFrame({ base, slice, schema, large }: Readonly<{ base: string; slice: Slice; schema?: SliceSchema; large?: boolean }>) {
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => null);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [shown, setShown] = useState<{ top: number; height: number } | null>(null);
  // The sketch stays under the fade-in, then goes.
  const [settled, setSettled] = useState(false);
  // Tiles load when scrolled into view and a slot is free; the lightbox's frame at once.
  const [go, setGo] = useState(!!large);
  const release = useRef(() => {});
  const json = JSON.stringify(slice);
  const [src, setSrc] = useState(() => sectionSrc(base, json));
  useEffect(() => {
    const t = setTimeout(() => setSrc(sectionSrc(base, json)), 300);
    return () => clearTimeout(t);
  }, [base, json]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = box.current;
    if (go || !el) return;
    if (typeof IntersectionObserver === "undefined") return setGo(true);
    let queued = false;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !queued) {
        queued = true;
        release.current = acquireFrame(() => (io.disconnect(), setGo(true)));
      } else if (!e?.isIntersecting && queued) {
        queued = false;
        release.current();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [go]);
  useEffect(() => {
    const slot = release;
    // Safety net: a frame that never reports does not hold its slot forever.
    const t = go ? setTimeout(() => slot.current(), SLOT_MS) : undefined;
    return () => {
      clearTimeout(t);
      slot.current();
    };
  }, [go]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setSettled(true), 200);
    return () => clearTimeout(t);
  }, [shown]);
  useEffect(() => {
    // Only this frame's posts count; the bridge's rect list is validated like the canvas overlay's.
    const onMessage = (e: MessageEvent) => {
      if (!fromFrame(e, frame.current) || e.data?.__typren !== true || e.data.type !== "rects") return;
      const r = toRects(e.data.rects)[0];
      if (!r || r.height <= 0) return;
      release.current();
      confirmRoute(base);
      const top = Math.min(Math.max(0, r.top), RENDER.height - 1);
      setShown({ top, height: Math.min(r.height, RENDER.height - top) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [base]);
  const height = shown?.height ?? RENDER.height;
  // Fit the slice inside the box; hidden, it still keeps a real size so the lazy frame loads.
  const scale = shown ? Math.min(size.w / RENDER.width, size.h / height) : size.w / RENDER.width;
  return (
    <div
      ref={box}
      onClick={large ? (e) => e.stopPropagation() : undefined}
      // The frame's geometry is inline: it is computed, and must hold without the host's CSS.
      style={{ position: "relative", overflow: "hidden", width: "100%", aspectRatio: large ? "16 / 9" : "4 / 3" }}
      className={cn(
        "rounded-[var(--typren-radius-control)] bg-[var(--typren-card-bg)] shadow-sm ring-1 ring-[var(--typren-stroke-card)]",
        // Over the lightbox backdrop the card-bg tint would let the page show through.
        large && "max-h-full max-w-5xl bg-[var(--typren-card)]"
      )}
    >
      {!settled && (
        <div className="absolute inset-0 [&>*]:h-full [&>*]:max-w-none [&>*]:shadow-none [&>*]:ring-0">
          <SliceSketch slice={slice} schema={schema} large={large} />
        </div>
      )}
      {origin && go && (
        <div
          aria-hidden
          className="transition-opacity duration-200 motion-reduce:transition-none"
          style={{
            position: "absolute",
            left: (size.w - RENDER.width * scale) / 2,
            top: shown ? (size.h - height * scale) / 2 : 0,
            width: RENDER.width,
            height,
            overflow: "hidden",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            opacity: shown ? 1 : 0,
            pointerEvents: "none",
          }}
        >
          <iframe
            ref={frame}
            // A new src gets a new frame, so no frame history piles up (see DevicePreview).
            key={src}
            src={src}
            title={`${slice.slice} preview`}
            tabIndex={-1}
            onLoad={() => release.current()}
            sandbox={sandboxFor(src, origin)}
            style={{ display: "block", border: 0, width: RENDER.width, height: RENDER.height, marginTop: -(shown?.top ?? 0) }}
          />
        </div>
      )}
    </div>
  );
}

/** How long a probe waits for the route's first `rects` post. Generous, since
 *  a dev server compiles the route on its first request. */
const PROBE_MS = 20_000;
const probes = new Map<string, Promise<boolean>>();
/** Resolves a probe in flight as found: a tile's own render proves the route too. */
const finishers = new Map<string, () => void>();
const REMEMBER = "typren:section-route:";

/** Routes known to exist, kept for the session so a revisit skips the probe. */
function remembered(base: string) {
  try {
    return sessionStorage.getItem(REMEMBER + base) === "1";
  } catch {
    return false;
  }
}

function confirmRoute(base: string) {
  try {
    sessionStorage.setItem(REMEMBER + base, "1");
  } catch {
    // Private mode: the module memo still holds for this load.
  }
  finishers.get(base)?.();
}

/** Whether the section route at `base` exists, asked once per session: one
 *  hidden frame loads it with an empty slice and waits for the bridge's
 *  `rects` post, which only the route's SliceZone sends. A site without the
 *  route answers with its 404 page, so no post comes and tiles never frame.
 *  ponytail: a route that is merely slow past PROBE_MS reads as missing
 *  until a reload. */
export function probeSectionRoute(base: string, origin: string): Promise<boolean> {
  let probe = probes.get(base);
  if (!probe && remembered(base)) probes.set(base, (probe = Promise.resolve(true)));
  if (!probe) {
    probe = new Promise((resolve) => {
      const src = sectionSrc(base, JSON.stringify({ slice: "" }));
      const frame = document.createElement("iframe");
      frame.src = src;
      frame.setAttribute("sandbox", sandboxFor(src, origin));
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      // In the viewport but invisible and behind everything: Chromium throttles
      // rendering of an offscreen cross-origin frame, so its bridge never got a
      // frame to post `rects` from and the probe timed out.
      frame.style.cssText = "position:fixed;left:0;top:0;z-index:-1;width:1280px;height:800px;border:0;opacity:0;pointer-events:none";
      const done = (found: boolean) => {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        frame.remove();
        finishers.delete(base);
        if (found) confirmRoute(base);
        resolve(found);
      };
      finishers.set(base, () => done(true));
      const onMessage = (e: MessageEvent) => {
        if (fromFrame(e, frame) && e.data?.__typren === true && e.data.type === "rects") done(true);
      };
      const timer = setTimeout(() => done(false), PROBE_MS);
      window.addEventListener("message", onMessage);
      document.body.append(frame);
    });
    probes.set(base, probe);
  }
  return probe;
}

/** `base` unless its probe finds the route missing: tiles start loading at
 *  once, since a tile's own render confirms the route sooner than the probe. */
export function useSectionRoute(base: string | undefined) {
  const [missing, setMissing] = useState<string>();
  useEffect(() => {
    if (!base) return;
    let live = true;
    void probeSectionRoute(base, window.location.origin).then((ok) => live && !ok && setMissing(base));
    return () => {
      live = false;
    };
  }, [base]);
  return missing === base ? undefined : base;
}

/** A tile's place in the shared canvas: its slice, by content key, and its box. */
type Slot = { key: string; slice: Slice; el: HTMLElement };
type Grid = { ready: ReadonlySet<string>; legacy: boolean };
const GridContext = createContext<Grid | null>(null);
const SlotContext = createContext<(slot: Slot) => () => void>(() => () => {});

/** A slice's content key (FNV-1a over its JSON): equal slices share a render,
 *  and an edited one gets a new key, which a server-rendered canvas lacks. */
export function sliceKey(slice: Slice): string {
  const json = JSON.stringify(slice);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);

/**
 * Templates → Sections' gallery, drawn by one frame of the site's section
 * route in its many-section mode (`?slices=`, see `MultiSectionCanvas` in
 * core) instead of a frame per tile: one page load for the whole grid. The
 * frame lies over the grid, inside the same scrolling content, so it scrolls
 * with it natively; it is transparent, ignores the pointer, and only paints
 * where the tiles' thumbnails are. Each tile below it is a slot showing its
 * sketch until the canvas reports that slice drawn.
 *
 * The studio posts every slot's slice and box (in the frame's pixels: the
 * frame renders 1280px wide, so media queries match a desktop, and is scaled
 * to the grid) on load and whenever the grid resizes or its tiles change.
 * A server-rendered canvas only has the slices its URL carried, so a key it
 * reports missing that the URL lacked reloads the frame with the current
 * tiles; a client canvas renders the posted slices and never needs one.
 *
 * A site on an older core answers `?slices=` with the one-slice page, whose
 * bridge posts `rects`: the tiles then fall back to a frame each. A canvas
 * that never answers leaves the sketches.
 * ponytail: a server canvas's URL carries every tile in the folder, so a
 * folder of very large saved sections could pass the dev server's URL limit
 * (Node's is 16KB of headers) and show sketches. Splitting the tiles over a
 * few frames is the upgrade if that shows.
 */
function SectionGrid({ base, children }: Readonly<{ base: string; children: ReactNode }>) {
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => null);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const slots = useRef(new Set<Slot>());
  // Keys in the frame's URL, and whether the frame has answered since it loaded.
  const loaded = useRef(new Set<string>());
  const answered = useRef(false);
  const [tiles, setTiles] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [src, setSrc] = useState<string>();
  const [scheme, setScheme] = useState<string>();
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
  const [legacy, setLegacy] = useState(false);

  const add = useCallback((slot: Slot) => {
    slots.current.add(slot);
    setTiles((n) => n + 1);
    return () => {
      slots.current.delete(slot);
      setTiles((n) => n + 1);
    };
  }, []);
  const load = useCallback(() => {
    const map: Record<string, Slice> = {};
    for (const s of slots.current) map[s.key] = s.slice;
    loaded.current = new Set(Object.keys(map));
    answered.current = false;
    setScheme(undefined);
    setReady(new Set());
    setSrc(`${base}${base.includes("?") ? "&" : "?"}slices=${encodeURIComponent(JSON.stringify(map))}`);
  }, [base]);
  // Frame pixels per grid pixel is width / RENDER.width.
  const post = useCallback(() => {
    const el = box.current;
    if (!el || !answered.current || !el.clientWidth) return;
    const k = el.clientWidth / RENDER.width;
    const at = el.getBoundingClientRect();
    const items = [...slots.current].map(({ key, slice, el: tile }) => {
      const r = tile.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(tile).borderTopLeftRadius) || 0;
      return { key, slice, left: (r.left - at.left) / k, top: (r.top - at.top) / k, width: r.width / k, height: r.height / k, radius: radius / k };
    });
    postToFrame(frame.current, { __typren: true, type: "sections", items });
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!src && slots.current.size) load();
    // One rAF coalesces a folder's worth of slots arriving together.
    const f = requestAnimationFrame(post);
    return () => cancelAnimationFrame(f);
  }, [tiles, width, height, src, load, post]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!fromFrame(e, frame.current) || e.data?.__typren !== true) return;
      const d = e.data;
      if (d.type === "rects") return setLegacy(true);
      if (d.type !== "sections") return;
      if (!answered.current) {
        answered.current = true;
        confirmRoute(base);
        // The browser keeps a frame transparent only while its colour scheme matches the page's.
        setScheme(typeof d.colorScheme === "string" && /^[a-z ]*$/.test(d.colorScheme) && d.colorScheme ? d.colorScheme : "normal");
        post();
      }
      setReady(new Set(strings(d.ready)));
      // Only a tile still shown counts: a reply to an older layout may name tiles since gone.
      const shown = new Set([...slots.current].map((s) => s.key));
      if (strings(d.missing).some((k) => shown.has(k) && !loaded.current.has(k))) load();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [base, load, post]);

  const grid = useMemo(() => ({ ready, legacy }), [ready, legacy]);
  const k = width / RENDER.width;
  return (
    <SlotContext.Provider value={add}>
      <GridContext.Provider value={grid}>
        <div ref={box} className="relative">
          {children}
          {origin && src && k > 0 && !legacy && (
            <iframe
              ref={frame}
              // A new src gets a new frame, so no frame history piles up (see DevicePreview).
              key={src}
              src={src}
              title="Section previews"
              aria-hidden
              tabIndex={-1}
              sandbox={sandboxFor(src, origin)}
              // Above the tiles (their hover pills sit higher still), but clicks go through.
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                zIndex: 1,
                border: 0,
                width: RENDER.width,
                height: height / k,
                transform: `scale(${k})`,
                transformOrigin: "0 0",
                pointerEvents: "none",
                colorScheme: scheme,
                opacity: scheme ? 1 : 0,
              }}
            />
          )}
        </div>
      </GridContext.Provider>
    </SlotContext.Provider>
  );
}

/** A gallery tile drawn by its grid's shared frame: the sketch until the
 *  frame reports the slice drawn, then (after the frame's fade) nothing. */
function SliceSlot({ grid, slice, schema }: Readonly<{ grid: Grid; slice: Slice; schema?: SliceSchema }>) {
  const add = useContext(SlotContext);
  const box = useRef<HTMLDivElement>(null);
  const key = useMemo(() => sliceKey(slice), [slice]);
  const latest = useRef(slice);
  latest.current = slice;
  useEffect(() => add({ key, slice: latest.current, el: box.current! }), [add, key]);
  const ready = grid.ready.has(key);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready) return setSettled(false);
    const t = setTimeout(() => setSettled(true), 250);
    return () => clearTimeout(t);
  }, [ready]);
  return (
    <div
      ref={box}
      data-typren-ready={ready ? "" : undefined}
      style={{ position: "relative", overflow: "hidden", width: "100%", aspectRatio: "4 / 3" }}
      className="rounded-[var(--typren-radius-control)] bg-[var(--typren-card-bg)] shadow-sm ring-1 ring-[var(--typren-stroke-card)]"
    >
      {!settled && (
        <div className="absolute inset-0 [&>*]:h-full [&>*]:max-w-none [&>*]:shadow-none [&>*]:ring-0">
          <SliceSketch slice={slice} schema={schema} />
        </div>
      )}
    </div>
  );
}

/** The site's render of a slice when the host has a section route, else its
 *  sketch. In a `SectionGrid` a tile is drawn by the grid's shared frame. */
export function SlicePreview({ base, ...props }: Readonly<{ base?: string; slice: Slice; schema?: SliceSchema; large?: boolean }>) {
  const grid = useContext(GridContext);
  if (!base) return <SliceSketch {...props} />;
  if (grid && !grid.legacy && !props.large) return <SliceSlot grid={grid} slice={props.slice} schema={props.schema} />;
  return <SliceFrame base={base} {...props} />;
}

/** The full viewer's "Insert into page": a page, a spot on it, and the
 *  slice as edited in the panel, added to that page's draft. */
function InsertIntoPage({
  host,
  pages,
  slice,
  locale,
  onOpenPage,
  onInserted,
}: Readonly<{
  host: TyprenStudioHost;
  pages: PageInfo[];
  slice: Slice;
  locale?: string;
  onOpenPage?: (slug: string) => void;
  onInserted?: () => void;
}>) {
  const [slug, setSlug] = useState<string | null>(null);
  // The page as picked: positions are offered from it, and the insert writes
  // against its version, so a change made since then is a conflict.
  const [picked, setPicked] = useState<{ page: PageContent; version: string | null } | null>(null);
  const [reads, setReads] = useState(0);
  const [at, setAt] = useState("end");
  const [status, setStatus] = useState<{ text: string; done?: string } | null>(null);
  const { getPage, readPage } = host;
  // ponytail: a host with only `readPage` has no version, so its insert
  // overwrites a racing save. Hosts give `getPage` to close that.
  const load = getPage ?? (readPage && ((s: string) => readPage(s).then((page) => ({ page, version: null }))));
  useEffect(() => {
    setPicked(null);
    if (!slug || !load) return;
    let live = true;
    load(slug).then(
      (p) => live && setPicked(p),
      () => {}
    );
    return () => {
      live = false;
    };
    // `load` is rebuilt each render; the host's readers are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reads, getPage, readPage]);

  if (!load) return <p className="text-sm text-[var(--typren-muted-fg)]">This studio can&rsquo;t read pages, so it can&rsquo;t insert.</p>;
  const spots = picked?.page.slices.map((s) => (typeof s.label === "string" ? s.label : titleCase(s.slice))) ?? [];
  const insert = async () => {
    if (!slug || !picked) return;
    setStatus({ text: "Inserting…" });
    try {
      const where = at === "end" ? at : Number(at);
      const result = await host.actions.insertSection(slug, slice, where, picked.version ?? undefined, locale);
      if (result.ok) {
        // The picker mirrors what core did, so positions stay right without a re-read.
        const slices = [...picked.page.slices];
        slices.splice(where === "end" ? slices.length : Math.min(where, slices.length), 0, slice);
        onInserted?.();
        setPicked({ page: { ...picked.page, slices }, version: result.version });
        setStatus({ text: `Added to the ${pages.find((p) => p.slug === slug)?.title ?? slug} draft.`, done: slug });
      } else {
        // Re-read, so the positions match the page as it is now.
        setReads((n) => n + 1);
        setAt("end");
        setStatus({ text: "The page changed since you picked it. Check the position and insert again." });
      }
    } catch (e) {
      setStatus({ text: `Insert failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const positions = [
    { value: "0", label: "At the top" },
    ...spots.map((label, i) => ({ value: String(i + 1), label: `After ${label}` })),
    { value: "end", label: "At the end" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <Select
        value={slug}
        items={pages.map((p) => ({ value: p.slug, label: p.title }))}
        onValueChange={(v) => {
          setSlug(v);
          setAt("end");
          setStatus(null);
        }}
      >
        <SelectTrigger aria-label="Page">
          <SelectValue placeholder="Choose a page" />
        </SelectTrigger>
        <SelectContent>
          {pages.map((p) => (
            <SelectItem key={p.slug} value={p.slug}>
              {p.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={at} items={positions} disabled={!slug} onValueChange={(v) => v && setAt(v)}>
        <SelectTrigger aria-label="Position">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {positions.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button disabled={!picked} onClick={() => void insert()}>
        Insert into page
      </Button>
      {status && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--typren-muted-fg)]">
          {status.text}
          {status.done && onOpenPage && (
            <Button variant="outline" size="sm" onClick={() => onOpenPage(status.done!)}>
              Open page
            </Button>
          )}
        </p>
      )}
    </div>
  );
}

/** The full viewer's right panel: the slice's fields, editable as the copy to
 *  insert (the saved section itself stays as saved), and where to insert it. */
function SectionPanel({
  host,
  pages,
  entry,
  slice,
  edited,
  onChange,
  onSaved,
  locale,
  onOpenPage,
  onInserted,
}: Readonly<{
  host: TyprenStudioHost;
  pages: PageInfo[];
  entry: LibraryEntry;
  slice: Slice;
  /** The panel's slice differs from the entry's. */
  edited: boolean;
  onChange: (next: Slice) => void;
  /** A save landed (or lost to a newer one): reload the library, and show
   *  `saved` when it is a new section. */
  onSaved: (saved?: SavedSlice) => void;
  locale?: string;
  onOpenPage?: (slug: string) => void;
  onInserted?: () => void;
}>) {
  const [saveStatus, setSaveStatus] = useState("");
  const { library } = host;
  const heading = (text: string) => <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--typren-muted-fg)]">{text}</h2>;
  const save = async () => {
    if (!library) return;
    setSaveStatus("Saving…");
    try {
      if (!entry.savedAt) {
        const saved = await library.save(entry.name, slice);
        setSaveStatus("");
        onSaved(saved);
        return;
      }
      const result = await library.update(entry.id, slice, entry.savedAt);
      setSaveStatus(
        result.ok
          ? "Saved"
          : result.code === "conflict"
            ? "This section changed elsewhere since you opened it. Save again to replace that version with yours."
            : "This section was deleted."
      );
      onSaved();
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <>
      <section className="flex flex-col gap-3">
        {heading("Properties")}
        <FieldForm slice={slice} schema={host.fieldSchema?.[slice.slice]} onChange={onChange} media={host.media} icons={host.icons} />
        {library && (
          <div className="flex flex-col gap-2">
            <Button variant="outline" disabled={!!entry.savedAt && !edited} onClick={() => void save()}>
              {entry.savedAt ? "Save changes" : "Save as new section"}
            </Button>
            {saveStatus && (
              <p role="status" className="text-sm text-[var(--typren-muted-fg)]">
                {saveStatus}
              </p>
            )}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3">
        {heading("Insert into page")}
        <InsertIntoPage host={host} pages={pages} slice={slice} locale={locale} onOpenPage={onOpenPage} onInserted={onInserted} />
      </section>
    </>
  );
}

/** Drag payload type for a saved section's id. */
export const SECTION_DRAG_TYPE = "application/x-typren-section";

/**
 * Templates → Sections: saved slices in their folders, and every slice type
 * in the Built-in folder, browsed like Assets (see `LibraryBrowser`). The
 * full viewer's panel edits a copy of the slice and inserts it into a
 * page's draft. `rev` reloads the lists after the rail changed them;
 * `onChange` reports this screen's own changes (without it, it reloads).
 */
export function SectionsLibrary({
  host,
  pages,
  view,
  locale,
  folder = "",
  rev,
  onOpenFolder = () => {},
  onChange,
  onOpenPage,
  onInserted,
}: Readonly<{
  host: TyprenStudioHost;
  pages: PageInfo[];
  view: AssetView;
  locale?: string;
  folder?: string;
  rev?: number;
  onOpenFolder?: (folder: string) => void;
  onChange?: () => void;
  onOpenPage?: (slug: string) => void;
  /** A page's draft changed: refresh the host's page list. */
  onInserted?: () => void;
}>) {
  const { library } = host;
  const { confirm, dialog } = useConfirm();
  const [data, setData] = useState<{ saved: SavedSlice[]; folders?: string[] } | null>(null);
  const [status, setStatus] = useState("");
  // The viewer's edits, for the entry open when they were made.
  const [draft, setDraft] = useState<{ id: string; slice: Slice } | null>(null);
  const load = () =>
    Promise.all([library?.list() ?? [], library?.folders?.list()]).then(
      ([saved, folders]) => setData({ saved, folders }),
      () => {
        setStatus("Couldn’t load saved sections.");
        setData((d) => d ?? { saved: [] });
      }
    );
  useEffect(() => {
    void load();
    // Reloads when the library or the shell's revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, rev]);
  const changed = () => (onChange ? onChange() : void load());
  const run = (fn: () => Promise<unknown>, failure: string) =>
    fn().then(
      () => (setStatus(""), changed()),
      () => (setStatus(failure), changed())
    );

  const entries = libraryEntries(data?.saved ?? [], host.sliceNames, host.defaults);
  const route = useSectionRoute(host.sectionPreviewUrl);
  const remove =
    library &&
    (async (e: LibraryEntry) => {
      if (!(await confirm({ title: "Delete section?", description: `Delete the saved section “${e.name}”?`, confirmLabel: "Delete", destructive: true }))) return;
      void run(() => library.remove(e.id), "Delete failed");
    });
  const folders = library?.folders;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {status && <p role="alert" className="px-6 pt-4 text-xs text-[var(--typren-destructive)]">{status}</p>}
      <LibraryBrowser<LibraryEntry>
        label="Sections"
        items={entries}
        folders={data?.folders}
        folder={folder}
        view={view}
        ready={!!data}
        dragType={SECTION_DRAG_TYPE}
        thumb={(e) => <SlicePreview base={route} slice={e.slice} schema={host.fieldSchema?.[e.slice.slice]} />}
        around={route ? (grid) => <SectionGrid key={route} base={route}>{grid}</SectionGrid> : undefined}
        icon={<LayoutPanelTop />}
        meta={(e) => (e.savedAt ? formatDate(e.savedAt) : "Built-in")}
        column={{ header: "Slice type", cell: (e) => e.slice.slice }}
        empty={<LibraryEmpty icon={<LayoutPanelTop />}>Save a section from a page with its heart button.</LibraryEmpty>}
        onOpenFolder={onOpenFolder}
        onRename={library && ((e, name) => void run(() => library.update(e.id, e.slice, e.savedAt!, name), "Rename failed"))}
        onMove={library?.move && ((e, to) => void run(() => library.move!(e.id, to, e.savedAt), "Move failed"))}
        onDelete={remove}
        onRenameFolder={folders && ((f, to) => void run(() => folders.rename(f, to), "Rename failed").then(() => folder === f && onOpenFolder(to)))}
        onDeleteFolder={folders && ((f) => void run(() => folders.delete(f), "Delete failed"))}
        viewer={({ item: open, index, count, mode, step, close, open: show }) => {
          const shown = draft?.id === open.id ? draft.slice : open.slice;
          return (
            <Lightbox
              title={open.name}
              mode={mode}
              index={index}
              count={count}
              noun="section"
              onStep={step}
              onClose={close}
              panel={
                <SectionPanel
                  key={open.id}
                  host={host}
                  pages={pages}
                  entry={open}
                  slice={shown}
                  edited={JSON.stringify(shown) !== JSON.stringify(open.slice)}
                  onChange={(slice) => setDraft({ id: open.id, slice })}
                  onSaved={(saved) => {
                    changed();
                    if (!saved) return;
                    // The new section opens in place of the built-in it came from.
                    setDraft(null);
                    setData((d) => ({ ...d, saved: [...(d?.saved ?? []), saved] }));
                    show(saved);
                  }}
                  locale={locale}
                  onOpenPage={onOpenPage}
                  onInserted={onInserted}
                />
              }
            >
              <SlicePreview base={route} slice={shown} schema={host.fieldSchema?.[open.slice.slice]} large />
            </Lightbox>
          );
        }}
      />
      {dialog}
    </div>
  );
}
