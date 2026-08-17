"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";

/** What FieldForm needs to wire up the "icon" control's searchable picker — a
 *  thin view over the host's icon library, mirroring `FieldFormMedia`'s seam
 *  (image-picker-field.tsx / @typren/core's sections.ts). The package MUST NOT
 *  import an icon library itself (it can't depend on whichever one the host
 *  ships); absent → the "icon" control degrades to a plain text input, same
 *  degrade contract as `media`. */
export type FieldFormIcons = {
  /** Synchronous — unlike `media.list()` there's no fetch, the host's icon set
   *  is a static, already-tree-shaken import. `name` is the value stored on
   *  the field (whatever string the host's content authors already use, e.g.
   *  "/img/money.svg"); `render()` returns a small preview element for a
   *  picker row. */
  list: () => Array<{ name: string; render: () => ReactNode }>;
};

/** A single icon-valued field: the raw name in a text input (keeps the "it's
 *  just a string" escape hatch) plus — when `icons` is configured — a
 *  "Choose icon" button opening a native `<dialog>` searchable picker. Same
 *  native-dialog choice as ImagePickerField (focus trap/ESC/backdrop for free). */
export function IconPickerField({
  value,
  onChange,
  icons,
}: Readonly<{ value: string; onChange: (name: string) => void; icons?: FieldFormIcons }>) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [query, setQuery] = useState("");
  const all = icons?.list() ?? [];
  const current = all.find((i) => i.name === value);
  const filtered = all.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/img/…" />
        {icons && (
          <Button type="button" variant="outline" size="sm" onClick={() => dialogRef.current?.showModal()}>
            {current && (
              <span aria-hidden className="inline-flex size-4 items-center justify-center">
                {current.render()}
              </span>
            )}
            Choose icon
          </Button>
        )}
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
        )}
      </div>

      {/* `m-auto` below is load-bearing: a modal <dialog> is centred by the UA
          stylesheet via `margin: auto`, and Tailwind Preflight resets every
          margin to 0 — without it the picker opens hard against the top-left
          corner. `backdrop:` dims the page so it reads as modal. */}
      {icons && (
        <dialog
          ref={dialogRef}
          className="m-auto w-[min(90vw,480px)] rounded-lg border border-[var(--typren-border)] bg-[var(--typren-bg)] p-4 text-[var(--typren-fg)] backdrop:bg-black/30"
        >
          <Input
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--typren-muted-fg)]">No icons match “{query}”.</p>
          ) : (
            <ul className="mt-3 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto">
              {filtered.map((i) => (
                <li key={i.name}>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={i.name}
                    className="flex h-16 w-full flex-col items-center justify-center gap-1 p-1 text-[10px]"
                    onClick={() => {
                      onChange(i.name);
                      dialogRef.current?.close();
                    }}
                  >
                    <span aria-hidden className="inline-flex size-5 items-center justify-center">
                      {i.render()}
                    </span>
                    <span className="w-full truncate">{i.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => dialogRef.current?.close()}>
              Close
            </Button>
          </div>
        </dialog>
      )}
    </div>
  );
}
