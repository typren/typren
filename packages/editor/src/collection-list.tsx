"use client";

import { useState } from "react";
import { PencilLine, Trash2 } from "lucide-react";
import type { CollectionRecordInfo, SliceSchema } from "@typren/core";
import { Button } from "./primitives/button";

/** "titleField" -> "Title Field"; "photo_url" -> "Photo Url". */
function titleCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Resolve the list's primary (clickable, always-rendered) column and the
 *  extra data columns — pure so it's testable without mounting the table.
 *  Defaults: primary = `titleField`, else "title" if present in the schema,
 *  else the first schema key; extra columns = the explicit `columns` list,
 *  else the first 4 schema keys (primary excluded from "extra" — it gets its
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
   *  write actions configured for this collection — see `TyprenEditorHost`). */
  onDelete?: (slug: string) => Promise<void>;
}>) {
  const [pending, setPending] = useState<string | null>(null);

  const remove = async (slug: string) => {
    if (!onDelete || !confirm(`Delete "${slug}"? This cannot be undone.`)) return;
    setPending(slug);
    try {
      await onDelete(slug);
    } finally {
      setPending(null);
    }
  };

  if (records.length === 0)
    return <div className="p-8 text-center text-sm text-[var(--typren-muted-fg)]">No records yet.</div>;

  const { primary, extra } = resolveListColumns(schema, titleField, columns);

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border-b border-[var(--typren-border)] px-3 py-2 text-left text-xs font-semibold text-[var(--typren-muted-fg)]">
            {primary ? titleCase(primary) : "Record"}
          </th>
          {extra.map((c) => (
            <th
              key={c}
              className="border-b border-[var(--typren-border)] px-3 py-2 text-left text-xs font-semibold text-[var(--typren-muted-fg)]"
            >
              {titleCase(c)}
            </th>
          ))}
          {onDelete && (
            <th className="w-10 border-b border-[var(--typren-border)] px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.slug} className="hover:bg-[var(--typren-muted)]">
            <td className="border-b border-[var(--typren-border)] px-3 py-2 align-middle text-[var(--typren-fg)]">
              <div className="flex items-center gap-2">
                <button type="button" className="font-medium hover:underline" onClick={() => onSelect(r.slug)}>
                  {primary ? cellText(r.meta, primary) || r.slug : r.slug}
                </button>
                {r.hasDraft && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--typren-border)] px-2 py-0.5 text-xs text-[var(--typren-muted-fg)]">
                    <PencilLine className="size-3" /> draft
                  </span>
                )}
                {r.locale && (
                  <span className="inline-flex items-center rounded-full border border-[var(--typren-border)] px-2 py-0.5 text-xs text-[var(--typren-muted-fg)]">
                    {r.locale}
                  </span>
                )}
              </div>
            </td>
            {extra.map((c) => (
              <td key={c} className="border-b border-[var(--typren-border)] px-3 py-2 align-middle text-[var(--typren-fg)]">
                {cellText(r.meta, c)}
              </td>
            ))}
            {onDelete && (
              <td className="border-b border-[var(--typren-border)] px-3 py-2 align-middle">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${r.slug}`}
                  disabled={pending === r.slug}
                  onClick={() => remove(r.slug)}
                >
                  <Trash2 />
                </Button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
