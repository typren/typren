"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, GripVertical, Trash2 } from "lucide-react";
import type { Slice } from "@typren/core";
import { Button } from "./primitives/button";
import { Select } from "./primitives/select";
import { cn } from "./primitives/cn";

/** Reorderable list of slices: native drag-drop + keyboard-accessible up/down,
 *  plus add / duplicate / delete / select. Pure UI: all state changes go up. */
export function BlockList({
  slices,
  selectedIndex,
  sliceNames,
  onSelect,
  onReorder,
  onAdd,
  onDuplicate,
  onDelete,
}: Readonly<{
  slices: Slice[];
  selectedIndex: number;
  sliceNames: string[];
  onSelect: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: (name: string) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
}>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--typren-border)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--typren-muted-fg)]">Blocks</span>
        <label className="sr-only" htmlFor="add-slice">
          Add block
        </label>
        <Select
          id="add-slice"
          className="w-36"
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
          }}
        >
          <option value="">+ Add block…</option>
          {sliceNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>

      <ol className="flex-1 overflow-y-auto p-2">
        {slices.map((s, i) => {
          const selected = i === selectedIndex;
          return (
            <li
              key={i}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={cn(
                "mb-1 flex items-center gap-0.5 rounded-md border px-1.5 py-1.5 transition-colors",
                selected
                  ? "border-[var(--typren-ring)] bg-[var(--typren-muted)]"
                  : "border-transparent hover:bg-[var(--typren-muted)]",
                dragIndex === i && "opacity-40"
              )}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-[var(--typren-muted-fg)]" aria-hidden />
              <button
                type="button"
                onClick={() => onSelect(i)}
                className="min-w-0 flex-1 truncate text-left text-sm text-[var(--typren-fg)]"
              >
                <span className="font-medium">{s.slice}</span>
                {typeof s.heading === "string" && (
                  <span className="ml-1 text-[var(--typren-muted-fg)]">· {s.heading.replaceAll("**", "")}</span>
                )}
              </button>
              <Button variant="ghost" size="icon" disabled={i === 0} aria-label="Move up" onClick={() => onReorder(i, i - 1)}>
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={i === slices.length - 1}
                aria-label="Move down"
                onClick={() => onReorder(i, i + 1)}
              >
                <ChevronDown />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Duplicate" onClick={() => onDuplicate(i)}>
                <Copy />
              </Button>
              <Button variant="destructive" size="icon" aria-label="Delete" onClick={() => onDelete(i)}>
                <Trash2 />
              </Button>
            </li>
          );
        })}
        {slices.length === 0 && (
          <li className="px-2 py-4 text-center text-sm text-[var(--typren-muted-fg)]">
            No blocks yet. Add one above.
          </li>
        )}
      </ol>
    </div>
  );
}
