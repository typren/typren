"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DROP_RING, type folderDrop } from "./primitives/sortable";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";

/** Sets `data-scrolled` on the bar once its scroll container has moved, so the
 *  blur shows only while content is actually under it. */
function useScrolled() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    const scroller = bar?.closest("[data-slot=scroll-area-viewport]");
    if (!bar || !scroller) return;
    const sync = () => bar.toggleAttribute("data-scrolled", scroller.scrollTop > 0);
    sync();
    scroller.addEventListener("scroll", sync, { passive: true });
    return () => scroller.removeEventListener("scroll", sync);
  }, []);
  return ref;
}

// Strongest first: each layer blurs less and reaches further down, so the
// stack eases from 20px of blur at the top to none past the bar.
const BLUR_LAYERS = [
  { px: 12, solid: 35, clear: 60 },
  { px: 6, solid: 60, clear: 85 },
  { px: 2, solid: 85, clear: 100 },
];

/** First child of the breadcrumb bar; the bar's controls are `relative` to
 *  sit above it. A progressive blur, so items fade into it instead of
 *  meeting an edge; it toggles instantly, since a fade reads as lag while
 *  scrolling. No negative z-index and no blend mode: either cuts the bar off
 *  from what scrolls beneath, and nothing blurs. The box runs 20px past the
 *  48px bar, or past the list's pinned header row too (`tall`), which sits
 *  above it and stays crisp. */
function TopBlur({ tall }: Readonly<{ tall?: boolean }>) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 opacity-0 group-data-[scrolled]/bar:opacity-100", tall ? "-bottom-[68px]" : "-bottom-5")}>
      {BLUR_LAYERS.map(({ px, solid, clear }) => {
        const mask = `linear-gradient(to bottom, black ${solid}%, transparent ${clear}%)`;
        return <div key={px} className="absolute inset-0" style={{ backdropFilter: `blur(${px}px)`, maskImage: mask, WebkitMaskImage: mask }} />;
      })}
    </div>
  );
}

/** Drop props for a breadcrumb, from the browser's own folder drop. */
type DropProps = ReturnType<typeof folderDrop>;

/**
 * The browsers' pinned breadcrumb bar: Finder-style back and forward through
 * the folders visited, then the path from `rootLabel` down to `folder`, each
 * step a button and, with `dropOn`, a drop target. Sits first inside the
 * browser's ScrollArea viewport.
 */
export function FolderBar({
  folder,
  rootLabel,
  view,
  onOpenFolder,
  label = (f) => f.slice(f.lastIndexOf("/") + 1),
  dropOn,
  over,
}: Readonly<{
  folder: string;
  rootLabel: string;
  view: "gallery" | "list";
  onOpenFolder: (folder: string) => void;
  /** A folder's name in the path. */
  label?: (folder: string) => string;
  dropOn?: (folder: string) => Partial<DropProps>;
  /** The folder a drag is hovering. */
  over?: string | null;
}>) {
  const bar = useScrolled();
  const [trail, setTrail] = useState({ stack: [folder], at: 0 });
  // A folder change from elsewhere (the rail, a folder tile) is matched
  // against the neighbours first, so it steps instead of branching.
  useEffect(() => {
    setTrail(({ stack, at }) => {
      if (stack[at] === folder) return { stack, at };
      if (stack[at - 1] === folder) return { stack, at: at - 1 };
      if (stack[at + 1] === folder) return { stack, at: at + 1 };
      return { stack: [...stack.slice(0, at + 1), folder], at: at + 1 };
    });
  }, [folder]);
  const path = ["", ...(folder ? folder.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")) : [])];
  return (
    <nav ref={bar} aria-label="Folder" className={cn("group/bar sticky top-0 z-10 -mx-6 flex h-12 items-center gap-1 px-4 [&>:not([aria-hidden])]:relative", view === "list" ? "mb-0" : "mb-2")}>
      <TopBlur tall={view === "list"} />
      <Button variant="ghost" size="icon-sm" aria-label="Back" disabled={trail.at === 0} onClick={() => onOpenFolder(trail.stack[trail.at - 1]!)}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Forward" disabled={trail.at === trail.stack.length - 1} onClick={() => onOpenFolder(trail.stack[trail.at + 1]!)}>
        <ChevronRight />
      </Button>
      <ol className="ml-2 flex min-w-0 items-center gap-1 text-sm">
        {path.map((f, i) => (
          <li key={f} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-[var(--typren-muted-fg)]" aria-hidden />}
            <button
              type="button"
              aria-current={i === path.length - 1 ? "location" : undefined}
              onClick={() => onOpenFolder(f)}
              {...dropOn?.(f)}
              className={cn(
                over === f && DROP_RING,
                "block max-w-48 cursor-pointer truncate transition-colors duration-150 motion-reduce:transition-none rounded-[calc(var(--typren-radius-control)-4px)] px-1.5 py-0.5 outline-none hover:bg-[var(--typren-muted)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]",
                i === path.length - 1 ? "font-medium text-[var(--typren-fg)]" : "text-[var(--typren-muted-fg)]"
              )}
            >
              {f ? label(f) : rootLabel}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
