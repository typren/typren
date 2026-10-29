"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { cn } from "./primitives/cn";
import { ToggleGroup, ToggleGroupItem } from "./primitives/toggle-group";

export type Device = "desktop" | "tablet" | "mobile";

const WIDTHS: Record<Device, number | null> = {
  desktop: null,
  tablet: 820,
  mobile: 390,
};
const DEVICES: { id: Device; icon: typeof Monitor; label: string }[] = [
  { id: "mobile", icon: Smartphone, label: "Mobile" },
  { id: "tablet", icon: Tablet, label: "Tablet" },
  { id: "desktop", icon: Monitor, label: "Desktop" },
];

// ponytail: the preview publishes its custom width's preset here so the shell's toggle, which owns
// `device`, can follow a drag without a new prop on every host. One preview at a time, like `dragged`.
type Sync = { preset: Device | null; clear: () => void } | null;
let sync: Sync = null;
const syncListeners = new Set<() => void>();
const publish = (next: Sync) => {
  sync = next;
  syncListeners.forEach((l) => l());
};
const subscribeSync = (l: () => void) => (syncListeners.add(l), () => void syncListeners.delete(l));

/** The global device switcher in the top bar. One value for every page, so
 *  it lives in the shell, not in each preview. While the preview has a custom width the toggle shows
 *  the preset that width equals, or none. */
export function DeviceToggle({ device, onChange }: Readonly<{ device: Device; onChange: (d: Device) => void }>) {
  const custom = useSyncExternalStore(
    subscribeSync,
    () => sync,
    () => null
  );
  const shown = custom ? (custom.preset ? [custom.preset] : []) : [device];
  return (
    <ToggleGroup
      aria-label="Device"
      value={shown}
      onValueChange={(next) => {
        const picked = next.find((d) => d !== shown[0]);
        if (!picked) return;
        custom?.clear();
        onChange(picked as Device);
      }}
    >
      {DEVICES.map(({ id, icon: Icon, label }) => (
        <ToggleGroupItem key={id} value={id} aria-label={label}>
          <Icon className="size-4" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A sandboxed frame without allow-same-origin gets an opaque origin, which
 *  Next dev treats as a cross-site request and 403s the page's own /_next
 *  assets, so the site would render unstyled. A frame already on another
 *  origin than the studio cannot reach it either way, so it keeps its own
 *  origin; only a same-origin frame must stay opaque (allow-scripts plus
 *  allow-same-origin there would let it remove its own sandbox). */
export function sandboxFor(src: string, origin: string) {
  const crossOrigin = new URL(src, origin).origin !== origin;
  return crossOrigin ? "allow-scripts allow-forms allow-same-origin" : "allow-scripts allow-forms";
}

/** The origin a preview frame's messages carry: its src's origin when that is another origin, else
 *  "null", since `sandboxFor` keeps a same-origin frame opaque. The frame's WindowProxy stays the same
 *  when it navigates, so `e.source` alone would also trust whatever origin the frame went on to load. */
export function frameOrigin(frame: HTMLIFrameElement) {
  const own = new URL(frame.src, window.location.origin).origin;
  return own === window.location.origin ? "null" : own;
}

/** Whether `e` is from `frame`, at the origin the frame was loaded on, and signed with the frame's
 *  session nonce when it has one (`data-typren-nonce`, the page canvas). */
export function fromFrame(e: MessageEvent, frame: HTMLIFrameElement | null | undefined) {
  if (!frame?.contentWindow || e.source !== frame.contentWindow || e.origin !== frameOrigin(frame)) return false;
  const nonce = frame.dataset.typrenNonce;
  return !nonce || e.data?.nonce === nonce;
}

/** Posts to `frame` only while it shows its own origin, signed with its session nonce when it has one.
 *  ponytail: an opaque frame can only be addressed with "*". Its sandbox follows it wherever it
 *  navigates, so a page it moves to is opaque too and receives these posts; the posts carry only
 *  draft style values, indexes and slices (content the studio frames anyway). The nonce stops such a
 *  page from speaking for the frame, not from reading; the page canvas on a site's own dev server is
 *  cross-origin, so it is addressed by origin. */
export function postToFrame(frame: HTMLIFrameElement | null | undefined, data: unknown) {
  if (!frame?.contentWindow) return;
  const origin = frameOrigin(frame);
  const nonce = frame.dataset.typrenNonce;
  frame.contentWindow.postMessage(nonce && data && typeof data === "object" ? { ...data, nonce } : data, origin === "null" ? "*" : origin);
}

const noSubscribe = () => () => {};

/** The narrowest a dragged preview goes: the smallest phone width sites design for. */
export const MIN_PREVIEW_WIDTH = 320;
/** How close the pointer pulls to a snap width before the preview sticks to it. */
export const SNAP_DISTANCE = 12;
const COMMON_WIDTHS = [360, 390, 768, 1024, 1280, 1440];

/** The widths a drag or arrow key stops at: the device presets plus common widths, within the
 *  available range. The desktop preset is the full available width, so only a finite `max` has one. */
export function snapPoints(max: number) {
  const widths = [WIDTHS.mobile!, WIDTHS.tablet!, ...COMMON_WIDTHS, ...(Number.isFinite(max) ? [max] : [])];
  return [...new Set(widths.filter((w) => w >= MIN_PREVIEW_WIDTH && w <= max))].sort((a, b) => a - b);
}

/** A magnetic detent: `raw` sticks to the nearest snap point within `distance`, else passes through.
 *  Fed the raw pointer width on every move, it holds until the pointer pulls past the distance. */
export function snapWidth(raw: number, points: number[], distance = SNAP_DISTANCE) {
  let best = raw;
  let gap = distance + 1;
  for (const p of points) {
    const d = Math.abs(raw - p);
    if (d < gap) [best, gap] = [p, d];
  }
  return best;
}

/** An arrow step from `from` to `to` that halts at the first snap point it crosses. */
export function stopAtSnap(from: number, to: number, points: number[]) {
  const dir = Math.sign(to - from);
  const crossed = points.filter((p) => (p - from) * dir > 0 && (to - p) * dir >= 0);
  return crossed.length ? (dir > 0 ? Math.min(...crossed) : Math.max(...crossed)) : to;
}

/** The preset a width equals, if any. */
export function presetAt(width: number, max: number): Device | null {
  if (width === WIDTHS.mobile) return "mobile";
  if (width === WIDTHS.tablet) return "tablet";
  return width === max ? "desktop" : null;
}

/** The size readout: the preset's name at a preset width, plain px elsewhere. `shown` is the number
 *  displayed while it rolls toward `width`, which alone picks the name. */
export function widthLabel(width: number, max: number, shown = width) {
  const preset = presetAt(width, max);
  return preset ? `${DEVICES.find((d) => d.id === preset)!.label} · ${shown}` : `${shown} px`;
}

const FLASH_MS = 1000;
const reducedMotion = () => typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `target`, eased toward frame by frame so a readout rolls instead of jumping. */
function useRolling(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  from.current = shown;
  useEffect(() => {
    if (reducedMotion()) return setShown(target);
    let raf = 0;
    const tick = () => {
      const next = from.current + (target - from.current) * 0.3;
      from.current = Math.abs(target - next) < 0.5 ? target : next;
      setShown(from.current);
      if (from.current !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return Math.round(shown);
}

/** The floating size readout. Always mounted so it can fade out; hidden from assistive tech, which
 *  gets the handle's aria-valuetext. */
function WidthLabel({ width, max, visible }: Readonly<{ width: number; max: number; visible: boolean }>) {
  const rolling = useRolling(width);
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-[var(--typren-radius-sm)] bg-[var(--typren-fg)] px-2 py-1 text-xs tabular-nums text-[var(--typren-bg)] transition-[opacity,transform] duration-150 motion-reduce:transition-none",
        visible ? "translate-y-0 scale-100 opacity-100" : "-translate-y-1 scale-95 opacity-0 motion-reduce:translate-y-0 motion-reduce:scale-100"
      )}
    >
      {widthLabel(width, max, rolling)}
    </div>
  );
}

const KEY_STEP: Record<string, number> = { ArrowLeft: -10, ArrowRight: 10 };

// ponytail: module-level for the same reason as frame.tsx's slide state: the
// preview remounts between browse and edit, and a dragged width should
// survive that. Two previews on one page would share it.
let dragged: { device: Device; width: number } | null = null;

/** The preview's custom width, set by dragging its edge or with arrow keys.
 *  Picking another device preset drops it; double-click restores the preset. */
function usePreviewWidth(device: Device) {
  const box = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState(() => (dragged?.device === device ? dragged.width : null));
  const [shownFor, setShownFor] = useState(device);
  if (shownFor !== device) {
    setShownFor(device);
    setCustom(null);
  }
  useEffect(() => {
    if (dragged?.device !== device) dragged = null;
  }, [device]);
  // Measured, for the full-width preset and the handle's aria-valuemax.
  const [measured, setMeasured] = useState({ width: 0, max: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(parent);
      const max = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setMeasured({ width: el.offsetWidth, max });
    });
    ro.observe(el);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const max = measured.max || Infinity;
  const current = Math.min(custom ?? WIDTHS[device] ?? measured.width, max);
  const resize = (w: number, how?: "drag" | { from: number }) => {
    let width = Math.round(Math.min(Math.max(w, MIN_PREVIEW_WIDTH), max));
    if (how === "drag") width = snapWidth(width, snapPoints(max));
    else if (how) width = stopAtSnap(how.from, width, snapPoints(max));
    setCustom(width);
    dragged = { device, width };
  };
  const reset = () => {
    setCustom(null);
    dragged = null;
  };
  const preset = custom == null ? null : presetAt(current, max);
  useEffect(() => {
    publish(custom == null ? null : { preset, clear: reset });
  });
  return { box, custom, current, max, resize, reset };
}

/** The drag handle on the preview's right edge. The preview is centred, so
 *  the edge moves half as far as the width changes: a drag counts double. */
function ResizeHandle({
  width,
  onDragging,
}: Readonly<{ width: ReturnType<typeof usePreviewWidth>; onDragging: (on: boolean) => void }>) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const onKey = (e: KeyboardEvent) => {
    const step = KEY_STEP[e.key];
    if (step) width.resize(width.current + step * (e.shiftKey ? 5 : 1), { from: width.current });
    else if (e.key === "Home") width.resize(MIN_PREVIEW_WIDTH);
    else if (e.key === "End") width.resize(width.max);
    else return;
    e.preventDefault();
  };
  const end = () => {
    start.current = null;
    onDragging(false);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize preview"
      aria-valuenow={width.current}
      aria-valuemin={MIN_PREVIEW_WIDTH}
      aria-valuemax={Number.isFinite(width.max) ? width.max : undefined}
      aria-valuetext={`${width.current} pixels wide`}
      title="Drag to resize, double-click to reset"
      onKeyDown={onKey}
      onDoubleClick={width.reset}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start.current = { x: e.clientX, w: width.box.current?.offsetWidth ?? width.current };
        onDragging(true);
      }}
      onPointerMove={(e) => start.current && width.resize(start.current.w + 2 * (e.clientX - start.current.x), "drag")}
      onPointerUp={end}
      onPointerCancel={end}
      className="group/handle absolute -right-3.5 top-0 z-10 hidden h-full w-3.5 cursor-ew-resize touch-none items-center justify-center rounded-[var(--typren-radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] md:flex"
    >
      <span
        aria-hidden
        className="h-10 w-1 rounded-full bg-[var(--typren-stroke-control-strong)] transition-colors duration-150 group-hover/handle:bg-[var(--typren-muted-fg)] group-active/handle:bg-[var(--typren-muted-fg)] motion-reduce:transition-none"
      />
    </div>
  );
}

/** The persistent page canvas, framed beside the real route (see `usePageCanvas`). */
export type CanvasFrame = { src: string; nonce: string; ref: RefObject<HTMLIFrameElement | null>; shown: boolean };

/** Full-bleed live preview in a rounded frame, narrowed to the chosen device
 *  width. `src` may be cross-origin (the studio frames the site's own dev
 *  server). `children` render over the frame, in its own box.
 *
 *  `canvas` adds the page canvas as a second frame in the same box, loaded
 *  once and never keyed on `reloadKey`; whichever of the two is not shown
 *  stays laid out but invisible, so switching costs no load. */
export function DevicePreview({
  src,
  device,
  reloadKey,
  iframeRef,
  canvas,
  children,
}: Readonly<{
  src: string;
  device: Device;
  reloadKey: number;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
  canvas?: CanvasFrame;
  children?: ReactNode;
}>) {
  const width = usePreviewWidth(device);
  const [dragging, setDragging] = useState(false);
  // A preset pick (or reset) changes the size without a drag, so it shows the readout for a second.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const was = useRef({ device, custom: width.custom });
  useEffect(() => {
    const prev = was.current;
    was.current = { device, custom: width.custom };
    if (prev.device === device && (width.custom != null || prev.custom == null)) return;
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);
  }, [device, width.custom]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  // The sandbox depends on the studio's origin, which only the browser knows, and a changed
  // sandbox never applies to a loaded frame, so the frame waits for the client render.
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => null
  );
  return (
    <div
      ref={width.box}
      className={cn(
        "relative mx-auto h-full max-w-full transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
        dragging && "transition-none"
      )}
      style={{ width: width.custom ?? WIDTHS[device] ?? "100%" }}
    >
      <div className="typren-surface-1 relative h-full overflow-hidden rounded-[var(--typren-radius-card)] border border-[var(--typren-stroke-card)] bg-[var(--typren-layer)]">
        {origin && (
          <iframe
            ref={iframeRef}
            // A new src gets a new frame: navigating a live frame adds an entry
            // to the tab's history, so Back would step the frame, not the studio.
            key={`${reloadKey} ${src}`}
            title="Live preview"
            src={src}
            // The frame renders unpublished draft content. A same-origin frame runs in an opaque origin
            // (no reach into this studio's DOM, cookies or storage); a cross-origin one is already isolated.
            sandbox={sandboxFor(src, origin)}
            aria-hidden={canvas?.shown || undefined}
            className={cn(
              "relative h-full w-full border-0 bg-[var(--typren-card)]",
              (dragging || canvas?.shown) && "pointer-events-none",
              canvas?.shown && "invisible"
            )}
          />
        )}
        {origin && canvas && (
          <iframe
            ref={canvas.ref}
            title="Page canvas"
            src={canvas.src}
            data-typren-nonce={canvas.nonce}
            sandbox={sandboxFor(canvas.src, origin)}
            aria-hidden={!canvas.shown || undefined}
            className={cn(
              "absolute inset-0 h-full w-full border-0 bg-[var(--typren-card)]",
              (dragging || !canvas.shown) && "pointer-events-none",
              !canvas.shown && "invisible"
            )}
          />
        )}
        {children}
      </div>
      <WidthLabel width={width.current} max={width.max} visible={dragging || flash} />
      <ResizeHandle width={width} onDragging={setDragging} />
    </div>
  );
}
