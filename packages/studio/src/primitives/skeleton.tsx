import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

/** A placeholder block. Size it to the content it stands in for, so the real
 *  content lands without moving anything. */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-subtle-hover)] motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

/** A rail list while it loads: `count` rows at the real rows' height and
 *  gap, inside the list's own padding, so it lands without moving. */
function RowsSkeleton({ count }: Readonly<{ count: number }>) {
  return (
    <div className="w-full space-y-1 px-3 pb-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[var(--typren-control-h)] w-full" />
      ))}
    </div>
  );
}

/** A tile grid while it loads: the real grid's auto-fill columns (`min`
 *  wide at least) and gaps, a tile at `aspect` and a name line per cell.
 *  `count` is a guess at one screenful. Mount it as `Loading`'s `skeleton`
 *  inside the grid's own padding. */
function TileGridSkeleton({ min, aspect, count }: Readonly<{ min: "9rem" | "13rem"; aspect: "square" | "4/3"; count: number }>) {
  return (
    <div
      className={cn(
        "grid w-full gap-x-4 gap-y-6",
        min === "9rem" ? "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className={cn("w-full", aspect === "square" ? "aspect-square" : "aspect-[4/3]")} />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** How long a load may take before its skeleton is painted. */
const DELAY = 150;

/**
 * Shows `skeleton` until `ready`, then fades `children` in. The skeleton
 * always takes its space, but stays invisible for the first 150ms so a fast
 * load never flashes it. The fade (opacity and a 4px lift, 180ms) only plays
 * when something was actually waiting, and not at all under reduced motion.
 * The box is a flex item filling its parent, which is what every screen root is.
 */
function Loading({ ready, skeleton, children, className }: Readonly<{ ready: boolean; skeleton: ReactNode; children: ReactNode; className?: string }>) {
  const [late, setLate] = useState(false);
  const waited = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ready) return;
    waited.current = true;
    const t = setTimeout(() => setLate(true), DELAY);
    return () => {
      clearTimeout(t);
      setLate(false);
    };
  }, [ready]);
  useLayoutEffect(() => {
    if (!ready || !waited.current) return;
    waited.current = false;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    box.current?.animate?.(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 180, easing: "cubic-bezier(0, 0, 0.2, 1)" }
    );
  }, [ready]);
  const flex = cn("flex min-w-0 flex-1", className);
  if (!ready)
    // `waited` is set by the effect, which runs after this first render; a
    // screen that mounts not ready is a screen that waited.
    return (
      <div role="status" aria-busy="true" aria-label="Loading" className={cn(flex, !late && "invisible")}>
        {skeleton}
      </div>
    );
  return (
    <div ref={box} className={flex}>
      {children}
    </div>
  );
}

export { Loading, RowsSkeleton, Skeleton, TileGridSkeleton };
