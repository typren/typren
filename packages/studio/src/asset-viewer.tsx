"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, Copy, Download, X } from "lucide-react";
import type { MediaAsset, MediaUse } from "@typren/core";
import { formatDate } from "./format";
import { humanSize } from "./media-grid";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { usePortal } from "./primitives/portal";
import { ScrollArea } from "./primitives/scroll-area";
import { useMediaUrl } from "./media-url";

/** How many references `uses` adds up to. */
export const totalUses = (uses: MediaUse[] | undefined) =>
  uses?.reduce((n, u) => n + u.count, 0) ?? 0;

/** The pages an asset appears on, each opening that page. */
export function UsageList({
  uses,
  onOpenPage,
}: Readonly<{ uses: MediaUse[]; onOpenPage?: (slug: string) => void }>) {
  if (!uses.length)
    return (
      <p className="text-sm text-[var(--typren-muted-fg)]">
        Not used on any page.
      </p>
    );
  return (
    <ul className="flex flex-col">
      {uses.map((u) => (
        <li key={`${u.locale}:${u.slug}`}>
          <button
            type="button"
            disabled={!onOpenPage}
            onClick={() => onOpenPage?.(u.slug)}
            className="flex w-full items-center gap-2 enabled:cursor-pointer transition-colors duration-150 motion-reduce:transition-none typren-concentric px-2 py-1.5 text-left text-sm outline-none enabled:hover:bg-[var(--typren-muted)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]"
          >
            <span className="min-w-0 flex-1 truncate">
              {u.slug === "settings" ? "Site settings" : `/${u.slug}`}
            </span>
            <span className="text-xs text-[var(--typren-muted-fg)]">
              {u.locale}
            </span>
            <span className="w-8 text-right text-xs tabular-nums text-[var(--typren-muted-fg)]">
              ×{u.count}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Keys typed into a field or an open popup (a select's list) belong to it,
 *  not to the viewer. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
    !!t.closest("[data-slot$='-content']"));

/**
 * The popup the Assets and Sections viewers share: it fades in over the
 * lightbox backdrop with `children` centred. "full" adds `panel` as a
 * floating panel on the right; "quick" is Space's Quick Look, the item
 * alone. Arrow keys step through the `count` items, Escape closes, and Space
 * closes Quick Look again. The backdrop is a blurred scrim of the frame
 * colour in the studio's own theme, so the studio stays in view behind it;
 * the header runs arrows and title, then the count and Close.
 */
export function Lightbox({
  title,
  mode,
  index,
  count,
  noun,
  onStep,
  onClose,
  panel,
  children,
}: Readonly<{
  title: string;
  mode: "full" | "quick";
  index: number;
  count: number;
  /** What one item is called, for the arrows' labels ("asset"). */
  noun: string;
  /** Steps by -1 or 1; never past either end. */
  onStep: (by: number) => void;
  onClose: () => void;
  panel?: ReactNode;
  children: ReactNode;
}>) {
  const portal = usePortal();
  const step = (by: number) => {
    if (index + by >= 0 && index + by < count) onStep(by);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key === " " && mode === "quick" ? "Escape" : e.key;
      if (key !== "Escape" && key !== "ArrowLeft" && key !== "ArrowRight")
        return;
      if (typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (key === "Escape") onClose();
      else step(key === "ArrowLeft" ? -1 : 1);
    };
    // Capture, so the browser underneath doesn't also act on the key.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Base UI's Dialog supplies the modal contract: aria-modal, focus moved in
  // and trapped, the rest of the page inert, focus returned to the opener.
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={portal ?? undefined}>
        <Dialog.Popup
          aria-modal
          aria-label={mode === "quick" ? `Quick Look: ${title}` : title}
          onClick={onClose}
          className="fixed inset-0 z-50 flex flex-col bg-[var(--typren-lightbox)] text-[var(--typren-fg)] backdrop-blur-[6px] transition-opacity duration-200 ease-out outline-none motion-reduce:transition-none starting:opacity-0"
        >
          <header
            onClick={(e) => e.stopPropagation()}
            className="flex h-14 shrink-0 items-center gap-2 px-4"
          >
            <span className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Previous ${noun}`}
                disabled={index === 0}
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Next ${noun}`}
                disabled={index === count - 1}
                onClick={() => step(1)}
              >
                <ChevronRight />
              </Button>
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {title}
            </span>
            <span className="text-xs tabular-nums text-[var(--typren-muted-fg)]">
              {index + 1} of {count}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={onClose}
            >
              <X />
            </Button>
          </header>
          <div
            className={cn(
              "flex min-h-0 flex-1 items-center justify-center p-10 pt-2",
              mode === "full" && "pr-[calc(20rem+3.5rem)]",
            )}
          >
            {children}
          </div>
          {mode === "full" && (
            // Positioned on a plain aside: ScrollArea's root sets an inline
            // `position: relative` that would beat an `absolute` class.
            <aside
              onClick={(e) => e.stopPropagation()}
              className="typren-surface-2 absolute bottom-4 right-4 top-14 w-80 overflow-hidden rounded-[var(--typren-radius-card)] bg-[var(--typren-card)] shadow-2xl ring-1 ring-[var(--typren-border)] transition duration-300 ease-out motion-reduce:transition-none starting:translate-x-4 starting:opacity-0"
            >
              <ScrollArea className="h-full" viewportClassName="p-5">
                <div className="flex flex-col gap-6">{panel}</div>
              </ScrollArea>
            </aside>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * An asset shown large over the studio. "full" is the viewer a double click
 * opens: the image beside its properties and where it is used. "quick" is
 * Space's Quick Look: the image alone.
 */
export function AssetViewer({
  assets,
  id,
  mode,
  uses,
  checker,
  onStep,
  onClose,
  onOpenPage,
}: Readonly<{
  assets: MediaAsset[];
  id: string;
  mode: "full" | "quick";
  uses?: MediaUse[];
  checker: CSSProperties;
  onStep: (id: string) => void;
  onClose: () => void;
  onOpenPage?: (slug: string) => void;
}>) {
  const resolve = useMediaUrl();
  const index = assets.findIndex((a) => a.id === id);
  const asset = assets[index];
  if (!asset) return null;
  return (
    <Lightbox
      title={asset.name}
      mode={mode}
      index={index}
      count={assets.length}
      noun="asset"
      onStep={(by) => onStep(assets[index + by]!.id)}
      onClose={onClose}
      panel={
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--typren-muted-fg)]">
              Properties
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ["Name", asset.name],
                  ["Type", asset.mime],
                  [
                    "Dimensions",
                    asset.width && asset.height
                      ? `${asset.width}×${asset.height}`
                      : "—",
                  ],
                  ["Size", humanSize(asset.size)],
                  ["Folder", asset.folder || "All Assets"],
                  ["Added", formatDate(asset.createdAt)],
                  ["URL", asset.url],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-[var(--typren-muted-fg)]">{label}</dt>
                  <dd
                    className={cn(
                      "min-w-0 break-all",
                      label === "URL" && "font-mono text-xs leading-5",
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(asset.url)}
              >
                <Copy /> Copy URL
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={asset.url} download={asset.name} />}
              >
                <Download /> Download
              </Button>
            </div>
          </section>
          {uses && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--typren-muted-fg)]">
                Used {totalUses(uses)}{" "}
                {totalUses(uses) === 1 ? "time" : "times"}
              </h2>
              <UsageList
                uses={uses}
                onOpenPage={
                  onOpenPage &&
                  ((slug) => {
                    onClose();
                    onOpenPage(slug);
                  })
                }
              />
            </section>
          )}
        </>
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- content-authored path has no static-import metadata next/image needs */}
      <img
        src={resolve(asset.url)}
        alt={asset.name}
        style={checker}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-[var(--typren-radius-sm)] object-contain shadow-md ring-1 ring-[var(--typren-border)]"
      />
    </Lightbox>
  );
}
