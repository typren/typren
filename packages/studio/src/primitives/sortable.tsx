import { useContext, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { GripVertical } from "lucide-react";
import { AnnounceContext } from "../announce";
import { cn } from "./cn";

/** Where a dragged row lands, relative to the row it is dropped on. */
export type Where = "before" | "after" | "inside";

/** Where a drag over a row would drop: its top or bottom quarter places
 *  before or after it, the middle of a row that `nests` nests inside. */
function dropZone(e: DragEvent<HTMLElement>, nests: boolean): Where {
  const box = e.currentTarget.getBoundingClientRect();
  const y = box.height ? (e.clientY - box.top) / box.height : 0;
  if (nests && y >= 0.25 && y <= 0.75) return "inside";
  return y < 0.5 ? "before" : "after";
}

const DROP: Record<Where, string> = {
  before: "shadow-[inset_0_2px_0_var(--typren-primary)]",
  after: "shadow-[inset_0_-2px_0_var(--typren-primary)]",
  inside: "ring-2 ring-inset ring-[var(--typren-ring)]",
};

/**
 * A reorderable list's rows. Spread `row(id)` on each row (an `<li>` that
 * holds a `DragHandle` and a focusable control): it drags, shows the drop
 * line, and moves with Alt+ArrowUp/Down from the keyboard. `onStep` makes
 * that keyboard move and returns the row's new id and what to announce, or
 * null when it can't move; focus follows the row to its new place.
 */
export function useSortable({
  onMove,
  onStep,
  nests = () => false,
}: Readonly<{
  onMove: (from: string, to: string, where: Where) => void;
  onStep: (id: string, by: -1 | 1) => { to: string; message: string } | null;
  /** Whether a row takes others dropped on its middle. */
  nests?: (id: string) => boolean;
}>) {
  const announce = useContext(AnnounceContext);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: Where } | null>(null);
  const refocus = useRef<{ list: HTMLElement; id: string } | null>(null);
  useLayoutEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    const row = r.list.querySelector<HTMLElement>(`[data-sort-id="${CSS.escape(r.id)}"]`);
    row?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
  });
  const end = () => (setDrag(null), setOver(null));
  return (id: string) => ({
    draggable: true,
    "data-sort-id": id,
    onDragStart: () => setDrag(id),
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (drag === null) return;
      e.preventDefault();
      const where = dropZone(e, nests(id));
      if (over?.id !== id || over.where !== where) setOver({ id, where });
    },
    onDragLeave: () => setOver(null),
    onDrop: () => {
      if (drag !== null && over && drag !== id) onMove(drag, id, over.where);
      end();
    },
    onDragEnd: end,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const done = onStep(id, e.key === "ArrowUp" ? -1 : 1);
      if (!done) return;
      refocus.current = { list: e.currentTarget.parentElement ?? e.currentTarget, id: done.to };
      announce(done.message);
    },
    className: cn("group/row relative", over?.id === id && DROP[over.where], drag === id && "opacity-40"),
  });
}

/** The grip a sortable row shows in its left gutter on hover or focus. The
 *  row positions it (`useSortable` gives it `relative` and `group/row`). */
export function DragHandle() {
  return (
    <GripVertical
      className="pointer-events-none absolute left-0 top-1/2 size-3 -translate-y-1/2 text-[var(--typren-muted-fg)] opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      aria-hidden
    />
  );
}

/** Drop props for a folder target: an item id dragged as `type` moves into
 *  it, OS files upload to it. `over` reports the hover so the target can
 *  highlight. Anything else falls through to the parent. */
export function folderDrop(
  folder: string,
  {
    onMove,
    onFiles,
    setOver,
    type,
  }: { onMove?: (id: string, folder: string) => void; onFiles?: (files: FileList, folder: string) => void; setOver: (f: string | null) => void; type: string }
) {
  const accepts = (e: DragEvent) => (onMove && e.dataTransfer.types.includes(type)) || (onFiles && e.dataTransfer.types.includes("Files"));
  return {
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      setOver(folder);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
    },
    onDrop: (e: DragEvent) => {
      setOver(null);
      const id = e.dataTransfer.getData(type);
      const files = e.dataTransfer.files;
      if (!id && !files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      if (id) onMove?.(id, folder);
      else onFiles?.(files, folder);
    },
  };
}

/** The tint and ring on a folder that a drag is hovering. */
export const DROP_RING = "bg-[var(--typren-fill-subtle-selected)] ring-2 ring-[var(--typren-ring)]";
