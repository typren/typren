"use client";

import {
  ChevronDown,
  ChevronUp,
  Copy,
  LayoutPanelTop,
  Trash2,
} from "lucide-react";
import type { Slice } from "@typren/core";
import { Button } from "./primitives/button";
import { EmptyState } from "./primitives/empty";
import { AddMenu } from "./primitives/add-button";
import { PanelHeader } from "./primitives/panel-header";
import { cn } from "./primitives/cn";
import { ScrollArea } from "./primitives/scroll-area";
import { SelectionList, rowClass } from "./primitives/selection";
import { DragHandle, useSortable } from "./primitives/sortable";

/** Row actions stay out of the way until a row is hovered, focused or selected. */
const rowAction = (selected: boolean) =>
  cn(
    "group-hover/row:opacity-100 group-hover/row:disabled:opacity-50 focus-visible:opacity-100",
    selected ? "opacity-100" : "opacity-0 disabled:opacity-0",
  );

/** Reorderable list of slices: native drag-drop + keyboard-accessible up/down,
 *  plus add / duplicate / delete / select. Pure UI: all state changes go up.
 *  A row is labelled by the slice's `label` prop when it has one, else its
 *  slice name. */
export function BlockList({
  title,
  slices,
  selectedIndex,
  sliceNames,
  onSelect,
  onReorder,
  onAdd,
  onDuplicate,
  onDelete,
}: Readonly<{
  /** Heading above the list (the page title in the studio rail). */
  title: string;
  slices: Slice[];
  selectedIndex: number;
  sliceNames: string[];
  onSelect: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (name: string) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
}>) {
  const name = (i: number) => {
    const s = slices[i]!;
    return typeof s.label === "string" ? s.label : s.slice;
  };
  const sortable = useSortable({
    onMove: (from, to, where) => {
      const f = Number(from);
      // The index `to` lands on once `from` is out of the list.
      let t = Number(to) + (where === "after" ? 1 : 0);
      if (f < t) t--;
      if (t !== f) onReorder(f, t);
    },
    onStep: (id, by) => {
      const i = Number(id);
      const j = i + by;
      if (j < 0 || j >= slices.length) return null;
      onReorder(i, j);
      return { to: String(j), message: `${name(i)} moved to position ${j + 1} of ${slices.length}` };
    },
  });

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={title}>
        <AddMenu label="Add section" options={sliceNames.map((n) => ({ value: n, label: n }))} onPick={onAdd} />
      </PanelHeader>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 pb-3">
        {/* The scroller sizes its content to fit-content, so a long heading
            would widen every row past the rail; pin the rail's width (w-72
            less px-3) so rows truncate and keep their actions in view. */}
        <SelectionList className="w-[16.5rem]">
        <ol className="space-y-1">
          {slices.map((s, i) => {
            const selected = i === selectedIndex;
            const { className, ...sort } = sortable(String(i));
            return (
              <li
                key={i}
                {...sort}
                aria-current={selected ? "page" : undefined}
                className={cn(className, rowClass(selected), "cursor-default gap-0.5 pl-0 pr-1")}
              >
                <DragHandle />
                <button
                  type="button"
                  onClick={() => onSelect(i)}
                  className="min-h-6 min-w-0 flex-1 cursor-pointer truncate pl-3 text-left font-normal outline-none"
                >
                  <span className="font-medium">{name(i)}</span>
                  {typeof s.heading === "string" && (
                    <span className="ml-1 text-[var(--typren-muted-fg)]">
                      · {s.heading.replaceAll("**", "")}
                    </span>
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={rowAction(selected)}
                  disabled={i === 0}
                  aria-label="Move up"
                  onClick={() => onReorder(i, i - 1)}
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={rowAction(selected)}
                  disabled={i === slices.length - 1}
                  aria-label="Move down"
                  onClick={() => onReorder(i, i + 1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={rowAction(selected)}
                  aria-label="Duplicate"
                  onClick={() => onDuplicate(i)}
                >
                  <Copy />
                </Button>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  className={rowAction(selected)}
                  aria-label="Delete"
                  onClick={() => onDelete(i)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
          {slices.length === 0 && (
            <li>
              <EmptyState icon={<LayoutPanelTop />} title="No sections yet. Add one above." />
            </li>
          )}
        </ol>
        </SelectionList>
      </ScrollArea>
    </div>
  );
}
