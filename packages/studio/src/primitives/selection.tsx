import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "./cn";

type Box = { x: number; y: number; w: number; h: number; moved: boolean };

/** Where the first element under `ref` matching `selector` sits, in the
 *  container's own coordinates (so it scrolls with the content and ignores
 *  ancestor transforms such as the rail slide). Null while there is none or
 *  it is hidden in a closed or closing collapsible. `moved` is true once the
 *  match is a different element from the last one, so callers can glide to it
 *  but not animate the first placement or a plain reflow. The container must
 *  be positioned. Re-places when `attrs` change anywhere beneath it. */
export function useSelectedBox(ref: RefObject<HTMLElement | null>, selector: string, attrs: string[]) {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let last: HTMLElement | null = null;
    // ponytail: the first moments after mount settle the route and the lists'
    // data, which can move the selection or swap its row for a fresh node; a
    // glide then reads as the fill jumping around on load. Fixed window, not
    // a signal from the loaders; raise it if a slow first load still glides.
    const settled = performance.now() + 400;
    const place = () => {
      const on = root.querySelector<HTMLElement>(selector);
      if (!on || on.closest("[hidden],[data-ending-style]")) {
        last = null;
        setBox(null);
        return;
      }
      let x = 0;
      let y = 0;
      for (let n: HTMLElement | null = on; n && n !== root; n = n.offsetParent as HTMLElement | null) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      const next = { x, y, w: on.offsetWidth, h: on.offsetHeight, moved: last !== null && last !== on && last.isConnected && performance.now() > settled };
      last = on;
      setBox((b) => (b && b.x === x && b.y === y && b.w === next.w && b.h === next.h ? b : next));
    };
    place();
    const mutations = new MutationObserver(place);
    mutations.observe(root, { attributes: true, childList: true, subtree: true, attributeFilter: attrs });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    resize?.observe(root);
    return () => {
      mutations.disconnect();
      resize?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selector and attrs are constants per call site
  }, [ref, selector]);
  return box;
}

/** A rail row: a control-high, full-width button (or any element holding
 *  one) with a hover fill. The selected row stays transparent and sets
 *  `aria-current="page"`, and its `SelectionList` paints the fill. */
export const rowClass = (active: boolean) =>
  cn(
    "flex h-[var(--typren-control-h)] w-full cursor-pointer items-center gap-2 transition-colors duration-150 motion-reduce:transition-none rounded-[var(--typren-radius-control)] px-3 text-left text-[15px] font-medium text-[var(--typren-fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]",
    !active && "typren-grain hover:bg-[var(--typren-fill-subtle-hover)]"
  );

/** A list whose selected row gets one fill that glides from the old row to the
 *  new one, instead of each row painting its own. Rows must stay transparent
 *  when selected and mark themselves with `aria-current`. */
export function SelectionList({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useSelectedBox(ref, '[aria-current="page"]', ["aria-current", "hidden", "data-ending-style"]);
  return (
    <div ref={ref} className={cn("relative isolate", className)}>
      {box && (
        <span
          aria-hidden
          style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
          className={cn(
            "typren-selected pointer-events-none absolute left-0 top-0 -z-10 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-subtle-selected)] motion-reduce:transition-none",
            box.moved && "transition-[transform,height] duration-[280ms] ease-[cubic-bezier(0.2,0,0,1)]"
          )}
        />
      )}
      {children}
    </div>
  );
}
