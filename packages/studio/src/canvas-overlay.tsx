"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Toolbar } from "@base-ui/react/toolbar";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Heart,
  LayoutTemplate,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react";
import { fromFrame } from "./device-preview";
import { useConfirm } from "./primitives/confirm";
import { Button } from "./primitives/button";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives/popover";
import { ScrollArea } from "./primitives/scroll-area";
import { AddMenu } from "./primitives/add-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./primitives/tooltip";

/** A block's box: in the preview frame's viewport as the bridge posts it,
 *  and in its page once `CanvasOverlay` is given the scroll it was measured at. */
export type SliceRect = {
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
};

/** The frame's `rects` payload, or `[]` if it is malformed. The frame renders
 *  draft content, so nothing it posts is trusted to be well formed. */
export function toRects(value: unknown): SliceRect[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is SliceRect =>
      !!r &&
      Number.isInteger(r.index) &&
      [r.top, r.left, r.width, r.height].every(
        (n) => typeof n === "number" && Number.isFinite(n),
      ),
  );
}

type Portal = HTMLElement | null;

/** The page's scroll offset, or null for a bridge that posts none. */
export type PageScroll = { x: number; y: number } | null;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The scroll a `rects` message was measured at, or null from an older
 *  bridge, whose rects are viewport rects it re-posts on every scroll. */
export function toScroll(d: { scrollX?: unknown; scrollY?: unknown }): PageScroll {
  return finite(d.scrollX) && finite(d.scrollY) ? { x: d.scrollX, y: d.scrollY } : null;
}

function ToolButton({
  label,
  onClick,
  disabled,
  destructive,
  portal,
  children,
}: Readonly<{
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  portal: Portal;
  children: ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toolbar.Button
            disabled={disabled}
            aria-label={label}
            onClick={onClick}
            render={
              <Button
                variant={destructive ? "destructive" : "ghost"}
                size="icon-sm"
                className="typren-concentric"
              />
            }
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent container={portal}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Studio chrome drawn over the preview frame from the rects the bridge
 * posts: on the active slice an Add section pill, a layers button and the
 * section toolbar. The bridge draws the outlines on the selected and active
 * slice inside the page, so they scroll with it; with an older bridge that
 * posts no `scroll`, they are drawn here instead.
 *
 * The controls sit on one layer in page coordinates, which each `scroll`
 * post from `frame` shifts with a single transform, written straight to the
 * DOM: no render per frame, and a re-measure only on a layout change. Only
 * the controls take the pointer; everything else falls through to the
 * frame. Pure UI: every change goes up through the same slice actions the
 * rail list uses.
 */
export function CanvasOverlay({
  rects,
  scroll = null,
  frame,
  active,
  selected,
  count,
  sliceNames,
  portal,
  formOpen,
  form,
  onFormOpenChange,
  onInsert,
  onLayers,
  onDuplicate,
  onSave,
  onMove,
  onRemove,
}: Readonly<{
  rects: SliceRect[];
  /** The scroll `rects` were measured at (they are in page coordinates then). */
  scroll?: PageScroll;
  /** The preview frame, whose `scroll` posts move the controls. */
  frame?: RefObject<HTMLIFrameElement | null>;
  /** The slice that gets the controls: the hovered one, else the selected one. */
  active: number;
  selected: number;
  count: number;
  sliceNames: string[];
  /** Where popups mount: inside the studio so they keep its theme scope. */
  portal: Portal;
  formOpen: boolean;
  /** The active slice's field form, shown in the Edit section popover. */
  form: ReactNode;
  onFormOpenChange: (open: boolean) => void;
  /** Insert a new slice named `name` at `at`, pushing the slice there down. */
  onInsert: (at: number, name: string) => void;
  onLayers: (i: number) => void;
  onDuplicate: (i: number) => void;
  /** Saves slice `i` to the Sections library; omit when the host has none. */
  onSave?: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (i: number) => void;
}>) {
  const { confirm, dialog } = useConfirm();
  const rect = rects.find((r) => r.index === active && r.index < count);
  const selectedRect =
    selected !== active
      ? rects.find((r) => r.index === selected && r.index < count)
      : undefined;
  // Keep the controls on screen while a tall slice is scrolled partly above
  // the viewport: the page's scroll top is `--scroll-y`, kept by `shift`.
  const controlsTop = rect ? `calc(max(${rect.top}px, var(--scroll-y, 0px)) + 8px)` : 0;
  const layer = useRef<HTMLDivElement>(null);
  const shift = (x: number, y: number) => {
    const el = layer.current;
    if (!el) return;
    el.style.transform = `translate(${-x}px, ${-y}px)`;
    el.style.setProperty("--scroll-y", `${y}px`);
  };
  useLayoutEffect(() => {
    if (scroll) shift(scroll.x, scroll.y);
  }, [scroll]);
  const follows = Boolean(scroll);
  useEffect(() => {
    if (!follows) return;
    const onMessage = (e: MessageEvent) => {
      if (!fromFrame(e, frame?.current)) return;
      const d = e.data;
      if (d?.__typren === true && d.type === "scroll" && finite(d.x) && finite(d.y)) shift(d.x, d.y);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [follows, frame]);

  return (
    <TooltipProvider>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={layer} className="absolute inset-0">
          {!scroll && [selectedRect, rect].map(
            (r) =>
              r && (
                <div
                  key={r.index}
                  data-testid={`outline-${r.index}`}
                  className="absolute ring-2 ring-inset ring-[var(--typren-primary)]"
                  style={{
                    top: r.top,
                    left: r.left,
                    width: r.width,
                    height: r.height,
                  }}
                />
              ),
          )}
          {rect && (
            <>
              <div
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
                style={{ top: rect.top, left: rect.left + rect.width / 2 }}
              >
                <AddMenu
                  labelled
                  label="Add section above"
                  options={sliceNames.map((n) => ({ value: n, label: n }))}
                  onPick={(v) => onInsert(active, v)}
                />
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Show in sections list"
                className="pointer-events-auto absolute shadow-sm"
                style={{ top: controlsTop, left: rect.left + 8 }}
                onClick={() => onLayers(active)}
              >
                <Layers />
              </Button>
              <Toolbar.Root
                aria-label="Section"
                className="pointer-events-auto absolute flex -translate-x-full items-center gap-0.5 rounded-[var(--typren-radius-control)] bg-[var(--typren-bg)] p-1 shadow-sm ring-1 ring-[var(--typren-border)]"
                style={{ top: controlsTop, left: rect.left + rect.width - 8 }}
              >
                <Popover open={formOpen} onOpenChange={onFormOpenChange}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <PopoverTrigger
                          render={
                            <Toolbar.Button
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="typren-concentric"
                                  aria-label="Edit section"
                                />
                              }
                            />
                          }
                        />
                      }
                    >
                      <Pencil />
                    </TooltipTrigger>
                    <TooltipContent container={portal}>
                      Edit section
                    </TooltipContent>
                  </Tooltip>
                  <PopoverContent
                    container={portal}
                    align="end"
                    aria-label="Edit section"
                    className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-0"
                  >
                    <ScrollArea
                      className="max-h-[70vh]"
                      viewportClassName="h-auto max-h-[inherit] p-(--typren-inset-card)"
                    >
                      {form}
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
                {/* Layout variants arrive in phase 3. */}
                <ToolButton
                  label="View layouts (coming soon)"
                  disabled
                  portal={portal}
                >
                  <LayoutTemplate />
                </ToolButton>
                <ToolButton
                  label="Duplicate"
                  portal={portal}
                  onClick={() => onDuplicate(active)}
                >
                  <Copy />
                </ToolButton>
                <ToolButton
                  label="Save to Sections"
                  disabled={!onSave}
                  portal={portal}
                  onClick={() => onSave?.(active)}
                >
                  <Heart />
                </ToolButton>
                <ToolButton
                  label="Move up"
                  disabled={active === 0}
                  portal={portal}
                  onClick={() => onMove(active, active - 1)}
                >
                  <ChevronUp />
                </ToolButton>
                <ToolButton
                  label="Move down"
                  disabled={active === count - 1}
                  portal={portal}
                  onClick={() => onMove(active, active + 1)}
                >
                  <ChevronDown />
                </ToolButton>
                <ToolButton
                  label="Remove"
                  destructive
                  portal={portal}
                  onClick={async () => {
                    const at = active;
                    if (
                      await confirm({
                        title: "Remove this section?",
                        description:
                          "The section and its content are removed from this page's draft.",
                        confirmLabel: "Remove",
                        destructive: true,
                      })
                    )
                      onRemove(at);
                  }}
                >
                  <Trash2 />
                </ToolButton>
              </Toolbar.Root>
            </>
          )}
        </div>
      </div>
      {dialog}
    </TooltipProvider>
  );
}
