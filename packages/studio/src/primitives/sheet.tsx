import { useRef, type PointerEvent, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { usePortal } from "./portal";

/**
 * Sheet: an iOS-style bottom sheet, on Base UI's Dialog, so it keeps the
 * dialog's focus trap, Escape, focus return, `aria-modal` and labelled title.
 *
 * - It rises over a dimmed scrim to its detent. The one detent is `large`:
 *   full height less a small top gap (safe area + 10px) where the page behind
 *   peeks. ponytail: `large` only, the one a caller needs; add a `detent`
 *   prop with `medium` (about half height) when a caller wants it.
 * - A grabber sits top centre. Dragging the grabber or the header down
 *   dismisses past a quarter of the height or on a quick flick, and otherwise
 *   settles back; a scrim tap and Escape dismiss too. ponytail: drags start
 *   only from the grabber and header, not from content scrolled to its top.
 * - The top corners take the card radius; the bottom clears the safe area.
 * - It slides in and out over 250ms on an iOS-like curve, and only fades
 *   under reduced motion.
 *
 * `Sheet` and `SheetTrigger` are the dialog's root and trigger; the content
 * puts `header` (say, a search field) under the grabber and `children`
 * (wrap them in a ScrollArea) in the rest.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;

/** A drag farther than this share of the sheet's height dismisses it. */
const DISTANCE = 0.25;
/** As does a release faster than this, in px/ms. */
const FLICK = 0.5;
/** Movement before a press on the header counts as a drag, so taps and
 *  clicks into a field there still work. */
const SLOP = 6;

function SheetContent({ title, header, children }: Readonly<{ title: string; header?: ReactNode; children: ReactNode }>) {
  const portal = usePortal();
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const move = (dy: number | null) => {
    const el = sheet.current;
    if (!el) return;
    el.style.translate = dy === null ? "" : `0 ${dy}px`;
    el.style.transition = dy === null ? "" : "none";
  };
  // The drag follows the pointer on the window, since it leaves the header
  // at once; capturing it on press instead would swallow clicks into a field.
  const start = (e: PointerEvent) => {
    const y0 = e.clientY;
    const t0 = performance.now();
    let dy = 0;
    let on = false;
    const onMove = (m: globalThis.PointerEvent) => {
      dy = Math.max(0, m.clientY - y0);
      on ||= dy > SLOP;
      if (on) move(dy);
    };
    const onEnd = (u: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (!on) return;
      move(null);
      // The dialog's own close, so it runs its exit from where the drag left it.
      const fast = dy / Math.max(1, performance.now() - t0) > FLICK;
      if (u.type === "pointerup" && (dy > (sheet.current?.offsetHeight ?? 0) * DISTANCE || fast)) close.current?.click();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };
  return (
    <DialogPrimitive.Portal container={portal ?? undefined}>
      <DialogPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 isolate z-50 bg-[var(--typren-smoke)] transition-opacity duration-[250ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 supports-backdrop-filter:backdrop-blur-xs"
      />
      <DialogPrimitive.Popup
        ref={sheet}
        data-slot="sheet"
        className="typren-surface-2 fixed inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+10px)] z-50 flex flex-col rounded-t-[var(--typren-radius-card)] bg-[var(--typren-popover)] pb-[env(safe-area-inset-bottom)] text-sm text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)] outline-none transition-[translate,opacity] duration-[250ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[starting-style]:opacity-0"
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close ref={close} hidden />
        <div data-slot="sheet-header" className="flex shrink-0 touch-none flex-col gap-2 px-3 pb-2" onPointerDown={start}>
          <span aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--typren-stroke-control-strong)]" />
          {header}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetContent, SheetTrigger };
