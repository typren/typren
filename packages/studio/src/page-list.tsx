"use client";

import { PencilLine } from "lucide-react";
import type { PageInfo } from "@typren/core";

/** Page picker shown when no page is selected. Presentational except for the
 *  navigation callback: the host, not this component, decides what "open
 *  this slug" means for its own router. */
export function PageList({
  pages,
  onNavigate,
}: Readonly<{ pages: PageInfo[]; onNavigate: (slug: string) => void }>) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-1 text-2xl font-semibold text-[var(--typren-fg)]">Pages</h1>
      <p className="mb-6 text-sm text-[var(--typren-muted-fg)]">Choose a page to edit its blocks.</p>
      <ul className="divide-y divide-[var(--typren-border)] overflow-hidden rounded-lg border border-[var(--typren-border)]">
        {pages.map((p) => (
          <li key={p.slug}>
            <button
              type="button"
              onClick={() => onNavigate(p.slug)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--typren-muted)]"
            >
              <span className="font-medium text-[var(--typren-fg)]">{p.title}</span>
              <span className="font-mono text-xs text-[var(--typren-muted-fg)]">/{p.slug}</span>
              {p.hasDraft && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--typren-border)] px-2 py-0.5 text-xs font-medium text-[var(--typren-muted-fg)]">
                  <PencilLine className="size-3" /> draft
                </span>
              )}
            </button>
          </li>
        ))}
        {pages.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[var(--typren-muted-fg)]">
            No pages yet. Add one from the sidebar.
          </li>
        )}
      </ul>
    </div>
  );
}
