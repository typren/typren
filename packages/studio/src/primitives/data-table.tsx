import {
  useState,
  type ElementType,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "./cn";
import { Skeleton } from "./skeleton";
import { ScrollArea } from "./scroll-area";

export type DataColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Starting width in px. Default 160. */
  width?: number;
  /** Floor while resizing, in px. Default 48. */
  minWidth?: number;
  /** Default true; false for fixed columns such as row actions. */
  resizable?: boolean;
  className?: string;
  /** Makes the header a sort button; the value to order rows by. */
  sort?: (row: T) => string | number;
};

export type Sort = { id: string; dir: "asc" | "desc" };

/** Ascending, then descending, then back to the default order. */
export const nextSort = (sort: Sort | null | undefined, id: string): Sort | null =>
  sort?.id !== id ? { id, dir: "asc" } : sort.dir === "asc" ? { id, dir: "desc" } : null;

/** Orders `rows` by the sorted column; strings compare locale-aware with numbers
 *  numerically. Stable, so ties keep their default order. */
export function sortRows<T>(rows: T[], columns: DataColumn<T>[], sort: Sort | null | undefined): T[] {
  const get = columns.find((c) => c.id === sort?.id)?.sort;
  if (!sort || !get) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const [x, y] = [get(a), get(b)];
    return sign * (typeof x === "string" && typeof y === "string" ? x.localeCompare(y, undefined, { numeric: true }) : Number(x) - Number(y));
  });
}

const STEP = 16;
const DEFAULT_WIDTH = 160;

/**
 * The studio's table. Every column has a definite px width and an empty filler
 * column after the last one takes the leftover space, so each header edge sits
 * at the sum of the widths before it and a drag moves it 1:1 with the pointer
 * (a shared auto column would absorb the change and leave the edge behind).
 * Past the container's width the table scrolls sideways. Each separator also
 * resizes by arrow keys and resets on double-click, and shows only while the
 * pointer is near the edge or it has focus.
 * `gutter` lets the table scroll under its container's side padding (pass
 * that padding): the scroller runs edge to edge and the gutter becomes
 * padding inside the scrolled content, so rows run to the container's edge
 * instead of clipping at the padding, yet sit at the inset when not scrolled. Every cell is one line, clipped with an ellipsis, so
 * columns overflow alike. Rows are plain `<tr>`s, so
 * `rowProps` can add click, drag or drop handlers.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowProps,
  className,
  gutter = 0,
  stickyTop,
  sort,
  onSort,
}: Readonly<{
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement>;
  className?: string;
  gutter?: number;
  /** Pins the header this many px below the top of the surrounding vertical
   *  scroller. The table then drops its own horizontal scroller, which would
   *  otherwise be the header's sticky container; overflow scrolls the outer one. */
  stickyTop?: number;
  /** Controlled sort: the caller has already ordered `rows` (it may group
   *  them first, and needs the order for keyboard navigation). Omit both to
   *  let the table sort its own rows. */
  sort?: Sort | null;
  onSort?: (sort: Sort | null) => void;
}>) {
  const [own, setOwn] = useState<Sort | null>(null);
  const controlled = onSort !== undefined;
  const active = controlled ? sort : own;
  const ordered = controlled ? rows : sortRows(rows, columns, own);
  const toggle = (id: string) => (controlled ? onSort : setOwn)(nextSort(active, id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const widthOf = (c: DataColumn<T>) =>
    widths[c.id] ?? c.width ?? DEFAULT_WIDTH;
  const total = columns.reduce((sum, c) => sum + widthOf(c), 0);
  const resize = (c: DataColumn<T>, px: number) =>
    setWidths((w) => ({
      ...w,
      [c.id]: Math.max(c.minWidth ?? 48, Math.round(px)),
    }));

  // Tracked on window, not the handle: the pointer leaves the 8px handle as
  // soon as the column lags a frame, and the drag must keep going.
  const startDrag = (c: DataColumn<T>, e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const start = e.clientX;
    const from = widthOf(c);
    const cursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    setDragging(c.id);
    const move = (ev: globalThis.PointerEvent) => resize(c, from + ev.clientX - start);
    const end = () => {
      document.body.style.cursor = cursor;
      setDragging(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const Outer: ElementType = stickyTop === undefined ? ScrollArea : "div";
  const outer =
    stickyTop === undefined
      ? { scrollbars: "horizontal", style: { marginInline: -gutter }, viewportStyle: { paddingInline: gutter } }
      : { style: { marginInline: -gutter, paddingInline: gutter } };

  return (
    <Outer {...outer}>
      <table
        // aria-selected is only valid on a grid's rows, so a table with selectable rows is a grid.
        role={rowProps ? "grid" : undefined}
        style={{ width: total }}
        className={cn(
          "min-w-full table-fixed border-collapse text-sm",
          className,
        )}
      >
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={{ width: widthOf(c) }} />
          ))}
          <col />
        </colgroup>
        <thead>
          {/* Pinned, the header's edge is the browser's top blur, not a stroke. */}
          <tr className={cn(stickyTop === undefined && "border-b border-[var(--typren-stroke-divider)]")}>
            {columns.map((c) => (
              <th
                key={c.id}
                aria-sort={c.sort && active?.id === c.id ? (active.dir === "asc" ? "ascending" : "descending") : undefined}
                className={cn(
                  "group/th relative px-3 py-2 text-left text-xs font-normal text-[var(--typren-muted-fg)]",
                  stickyTop !== undefined && "sticky z-[11]",
                  c.className,
                )}
                style={stickyTop === undefined ? undefined : { top: stickyTop }}
              >
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="flex min-h-6 w-full cursor-pointer items-center gap-1 rounded-[var(--typren-radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]"
                  >
                    <span className="truncate">{c.header}</span>
                    <SortIcon dir={active?.id === c.id ? active.dir : undefined} />
                  </button>
                ) : (
                  <span className="block truncate">{c.header}</span>
                )}
                {c.resizable !== false && (
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuenow={Math.round(widthOf(c))}
                    aria-label={`Resize ${typeof c.header === "string" ? c.header : c.id} column`}
                    tabIndex={0}
                    data-dragging={dragging === c.id || undefined}
                    onPointerDown={(e) => startDrag(c, e)}
                    onDoubleClick={() =>
                      setWidths((w) => {
                        const next = { ...w };
                        delete next[c.id];
                        return next;
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
                        return;
                      e.preventDefault();
                      resize(
                        c,
                        widthOf(c) + (e.key === "ArrowRight" ? STEP : -STEP),
                      );
                    }}
                    className="absolute inset-y-1 -right-2 z-10 w-4 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[7px] after:w-0.5 after:rounded-full after:bg-[var(--typren-muted-fg)] after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:bg-[var(--typren-ring)] focus-visible:after:opacity-100 data-dragging:after:opacity-100"
                  />
                )}
              </th>
            ))}
            <th aria-hidden />
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => {
            const props = rowProps?.(row);
            return (
              <tr
                key={rowKey(row)}
                {...props}
                className={cn(
                  "border-b border-[var(--typren-stroke-divider)] transition-colors duration-150 hover:bg-[var(--typren-fill-subtle-hover)] motion-reduce:transition-none",
                  props?.className,
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      "truncate px-3 py-2 align-middle text-[var(--typren-fg)]",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
                <td aria-hidden />
              </tr>
            );
          })}
        </tbody>
      </table>
    </Outer>
  );
}

/** Fades in near the header cell or on focus; stays on the sorted column. */
function SortIcon({ dir }: Readonly<{ dir?: Sort["dir"] }>) {
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-3 shrink-0 transition-opacity duration-150 motion-reduce:transition-none group-focus-within/th:opacity-100 group-hover/th:opacity-100",
        dir ? "opacity-100" : "opacity-0"
      )}
    />
  );
}

/** A list while its rows load: a header-height gap, then `rows` rows at the
 *  browsers' 48px row height with a thumbnail and a name line, so the real
 *  table lands without moving. Mount it as `Loading`'s `skeleton`. */
export function DataTableSkeleton({ rows = 8 }: Readonly<{ rows?: number }>) {
  return (
    <div className="w-full">
      <div className="h-8" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-3 border-b border-[var(--typren-stroke-divider)] px-3">
          <Skeleton className="size-8 shrink-0" />
          <Skeleton className="h-4 w-48" />
        </div>
      ))}
    </div>
  );
}
