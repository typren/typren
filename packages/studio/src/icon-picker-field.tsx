"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./primitives/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "./primitives/dialog";
import { Input } from "./primitives/input";
import { SearchInput } from "./primitives/search-input";
import { ScrollArea } from "./primitives/scroll-area";

/** What FieldForm needs to wire up the "icon" control's searchable picker: a
 *  thin view over the host's icon library, mirroring `FieldFormMedia`'s seam
 *  (image-picker-field.tsx / @typren/core's sections.ts). The package MUST NOT
 *  import an icon library itself (it can't depend on whichever one the host
 *  ships); absent → the "icon" control degrades to a plain text input, same
 *  degrade contract as `media`. */
export type FieldFormIcons = {
  /** Synchronous: unlike `media.list()` there's no fetch, the host's icon set
   *  is a static, already-tree-shaken import. `name` is the value stored on
   *  the field (whatever string the host's content authors already use, e.g.
   *  "/img/money.svg"); `render()` returns a small preview element for a
   *  picker row. */
  list: () => Array<{ name: string; render: () => ReactNode }>;
};

/** A single icon-valued field: the raw name in a text input (keeps the "it's
 *  just a string" escape hatch) plus, when `icons` is configured, a
 *  "Choose icon" button opening a searchable picker in a Base UI Dialog,
 *  like ImagePickerField. */
export function IconPickerField({
  value,
  onChange,
  icons,
}: Readonly<{
  value: string;
  onChange: (name: string) => void;
  icons?: FieldFormIcons;
}>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const all = icons?.list() ?? [];
  const current = all.find((i) => i.name === value);
  const filtered = all.filter((i) =>
    i.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/img/…"
        />
        {icons && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            {current && (
              <span
                aria-hidden
                className="inline-flex size-4 items-center justify-center"
              >
                {current.render()}
              </span>
            )}
            Choose icon
          </Button>
        )}
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
          >
            Clear
          </Button>
        )}
      </div>

      {icons && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="w-[min(90vw,480px)]">
            <DialogTitle className="sr-only">Choose icon</DialogTitle>
            <SearchInput
              aria-label="Search icons"
              placeholder="Search icons…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {filtered.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--typren-muted-fg)]">
                No icons match “{query}”.
              </p>
            ) : (
              <ScrollArea
                className="mt-3 max-h-72"
                viewportClassName="h-auto max-h-[inherit]"
              >
                <ul className="grid grid-cols-4 gap-2">
                  {filtered.map((i) => (
                    <li key={i.name}>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={i.name}
                        className="flex h-16 w-full flex-col items-center justify-center gap-1 p-1 text-[10px]"
                        onClick={() => {
                          onChange(i.name);
                          setOpen(false);
                        }}
                      >
                        <span
                          aria-hidden
                          className="inline-flex size-5 items-center justify-center"
                        >
                          {i.render()}
                        </span>
                        <span className="w-full truncate">{i.name}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
