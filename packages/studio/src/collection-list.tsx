"use client";

import { useState } from "react";
import { PencilLine, Rows3, Trash2 } from "lucide-react";
import { EmptyState } from "./primitives/empty";
import type { CollectionRecordInfo, SliceSchema } from "@typren/core";
import { Button } from "./primitives/button";
import { useConfirm } from "./primitives/confirm";
import { DataTable } from "./primitives/data-table";

/** "titleField" -> "Title Field"; "photo_url" -> "Photo Url". */
export function titleCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Resolve the list's primary (clickable, always-rendered) column and the
 *  extra data columns, pure so it's testable without mounting the table.
 *  Defaults: primary = `titleField`, else "title" if present in the schema,
 *  else the first schema key; extra columns = the explicit `columns` list,
 *  else the first 4 schema keys (primary excluded from "extra", it gets its
 *  own always-present column so a record stays clickable even for an
 *  empty/unusual schema). Ported from meditor's `resolveListColumns`. */
export function resolveListColumns(
  schema: SliceSchema,
  titleField?: string,
  columns?: string[]
): { primary: string | undefined; extra: string[] } {
  const keys = Object.keys(schema);
  const primary = titleField ?? (keys.includes("title") ? "title" : keys[0]);
  const base = columns?.length ? columns : keys.slice(0, 4);
  return { primary, extra: base.filter((k) => k !== primary) };
}

function cellText(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return "src" in (v as object) ? String((v as { src?: unknown }).src ?? "") : JSON.stringify(v);
  return String(v);
}

/** Structural port of `page-list.tsx`, generalized to a collection record's
 *  arbitrary schema instead of a fixed page title. Presentational: rows in,
 *  `onSelect`/`onDelete` out. */
export function CollectionList({
  records,
  schema,
  titleField,
  columns,
  onSelect,
  onDelete,
}: Readonly<{
  records: CollectionRecordInfo[];
  schema: SliceSchema;
  titleField?: string;
  columns?: string[];
  onSelect: (slug: string) => void;
  /** Omit to render without a delete column (degrades read-only, e.g. no
   *  write actions configured for this collection, see `TyprenStudioHost`). */
  onDelete?: (slug: string) => Promise<void>;
}>) {
  const [pending, setPending] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const remove = async (slug: string) => {
    if (!onDelete) return;
    if (!(await confirm({ title: "Delete record?", description: `Delete "${slug}"? This cannot be undone.`, confirmLabel: "Delete", destructive: true }))) return;
    setPending(slug);
    try {
      await onDelete(slug);
    } finally {
      setPending(null);
    }
  };

  if (records.length === 0)
    return (
      <EmptyState icon={<Rows3 />} title="No records yet." />
    );

  const { primary, extra } = resolveListColumns(schema, titleField, columns);

  return (
    <>
      <DataTable
        rows={records}
        rowKey={(r) => r.slug}
        columns={[
          {
            id: primary ?? "record",
            header: primary ? titleCase(primary) : "Record",
            width: 280,
            cell: (r) => (
              <div className="flex items-center gap-2">
                <button type="button" className="cursor-pointer truncate font-medium hover:underline" onClick={() => onSelect(r.slug)}>
                  {primary ? cellText(r.meta, primary) || r.slug : r.slug}
                </button>
                {r.hasDraft && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--typren-border)] px-2 py-0.5 text-xs text-[var(--typren-muted-fg)]">
                    <PencilLine className="size-3" /> draft
                  </span>
                )}
                {r.locale && (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--typren-border)] px-2 py-0.5 text-xs text-[var(--typren-muted-fg)]">
                    {r.locale}
                  </span>
                )}
              </div>
            ),
          },
          ...extra.map((c) => ({ id: c, header: titleCase(c), cell: (r: CollectionRecordInfo) => <span className="block truncate">{cellText(r.meta, c)}</span> })),
          ...(onDelete
            ? [
                {
                  id: "actions",
                  header: <span className="sr-only">Actions</span>,
                  width: 56,
                  resizable: false,
                  cell: (r: CollectionRecordInfo) => (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${r.slug}`}
                      disabled={pending === r.slug}
                      onClick={() => remove(r.slug)}
                    >
                      <Trash2 />
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
    {dialog}
    </>
  );
}
