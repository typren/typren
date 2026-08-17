"use client";

import { useState, useTransition, type ReactNode } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import type { PageInfo } from "@typren/core";
import { useT } from "./intl";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";
import { cn } from "./primitives/cn";

/** Linear-style left navigation: the dynamic list of pages, plus New/delete.
 *  `children` (a block outline) renders below the page list when editing a
 *  page. Locale-aware: when a site has more than one locale, each row shows
 *  which locales the page exists in.
 *
 *  No routing inside this component — every navigation outcome (a newly
 *  created page, a delete, clicking a row) is reported via `onNavigate`
 *  rather than an `<a href>`/`window.location` write; the host decides what
 *  a slug (or `null`, meaning "back to the page picker") means for its URLs. */
export function PagesNav({
  pages,
  currentSlug,
  allLocales = [],
  onCreate,
  onDelete,
  onNavigate,
  children,
}: Readonly<{
  pages: PageInfo[];
  currentSlug?: string;
  /** Full locale set; more than one turns on the per-row translation dots. */
  allLocales?: string[];
  onCreate: (title: string) => Promise<string>;
  onDelete: (slug: string) => Promise<void>;
  /** A page slug to open, or `null` for the page picker. */
  onNavigate: (slug: string | null) => void;
  children?: ReactNode;
}>) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  const multiLocale = allLocales.length > 1;

  const create = () => {
    const nm = title.trim();
    if (!nm) return;
    startTransition(async () => {
      const slug = await onCreate(nm);
      setTitle("");
      setAdding(false);
      onNavigate(slug);
    });
  };
  const remove = (slug: string) => {
    if (!confirm(t("nav.confirmDelete", { slug }))) return;
    startTransition(async () => {
      await onDelete(slug);
      onNavigate(null);
    });
  };

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--typren-border)] bg-[var(--typren-bg)]">
      <div className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--typren-fg)]">
        <span className="grid size-5 place-items-center rounded bg-[var(--typren-primary)] text-[10px] font-bold text-[var(--typren-primary-fg)]">
          T
        </span>
        {t("nav.brand")}
      </div>

      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--typren-muted-fg)]">{t("nav.pages")}</span>
        <Button variant="ghost" size="icon" aria-label={t("nav.newPage")} disabled={pending} onClick={() => setAdding((v) => !v)}>
          <Plus />
        </Button>
      </div>

      {adding && (
        <div className="flex gap-1 px-3 pb-2">
          <Input
            autoFocus
            placeholder={t("nav.pageName")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setAdding(false);
            }}
            className="h-8"
          />
          <Button size="sm" disabled={pending || !title.trim()} onClick={create}>
            {t("nav.add")}
          </Button>
        </div>
      )}

      <ul
        className={cn(
          "space-y-0.5 overflow-y-auto px-2",
          children ? "max-h-[34vh] shrink-0" : "flex-1"
        )}
      >
        {pages.map((p) => {
          const active = p.slug === currentSlug;
          return (
            <li key={p.slug} className="group/row">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  active ? "bg-[var(--typren-muted)] text-[var(--typren-fg)]" : "text-[var(--typren-muted-fg)] hover:bg-[var(--typren-muted)] hover:text-[var(--typren-fg)]"
                )}
              >
                <FileText className="size-4 shrink-0 opacity-70" />
                <button
                  type="button"
                  onClick={() => onNavigate(p.slug)}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {p.title}
                </button>
                {multiLocale ? (
                  <span className="flex shrink-0 items-center gap-0.5" title={p.locales.join(", ")}>
                    {allLocales.map((l) => (
                      <span
                        key={l}
                        className={cn(
                          "size-1.5 rounded-full",
                          p.locales.includes(l) ? "bg-[var(--typren-primary)]" : "bg-[var(--typren-border)]"
                        )}
                      />
                    ))}
                  </span>
                ) : (
                  p.hasDraft && (
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--typren-primary)]" title="Has draft" />
                  )
                )}
                <button
                  type="button"
                  aria-label={t("nav.deletePage", { slug: p.slug })}
                  disabled={pending}
                  onClick={() => remove(p.slug)}
                  className="shrink-0 rounded p-0.5 text-[var(--typren-muted-fg)] opacity-0 transition-opacity hover:text-[var(--typren-destructive)] group-hover/row:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {children && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--typren-border)]">{children}</div>
      )}
    </nav>
  );
}
