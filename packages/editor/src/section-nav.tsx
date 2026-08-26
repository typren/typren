"use client";

import { Fragment, type ReactNode } from "react";
import { Copy, FileText, LayoutGrid, Image as ImageIcon, Moon, Settings, Sun } from "lucide-react";
import type { ResolvedSection, SectionKind } from "@typren/core";
import { cn } from "./primitives/cn";

const KIND_ICON: Record<SectionKind, typeof FileText> = {
  pages: FileText,
  media: ImageIcon,
  settings: Settings,
  collection: Copy,
  custom: LayoutGrid,
};

const GROUP_LABEL: Record<string, string> = { content: "Content", other: "Other" };

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Groups resolved sections "Content" then "Other" then any unknown groups,
 *  each in registration order — mirrors core's `resolveSections` default
 *  grouping so the rail's order never drifts from the config it renders. */
function groupSections(sections: ResolvedSection[]): { label: string; items: ResolvedSection[] }[] {
  const buckets = new Map<string, ResolvedSection[]>();
  for (const s of sections) {
    const arr = buckets.get(s.group);
    if (arr) arr.push(s);
    else buckets.set(s.group, [s]);
  }
  const order = ["content", "other", ...[...buckets.keys()].filter((g) => g !== "content" && g !== "other")];
  return order.filter((g) => buckets.has(g)).map((g) => ({ label: GROUP_LABEL[g] ?? titleCase(g), items: buckets.get(g)! }));
}

/**
 * `SectionShell`'s single left rail: the SDUI section switcher (spec-parity
 * with meditor's `<meditor-section-nav>`, ported fresh in React). Renders
 * purely from `sections` (`core`'s `resolveSections()` output) — no host code
 * runs here, matching `docs/hosted-platform.md`'s "renders from data, not
 * customer code" doctrine. Full navigation is reported via `onSelect`, not an
 * `<a href>`: this package never touches routing itself (see `EditorShell`'s
 * doc comment) — the host's `TyprenEditorProps.onNavigateSection` decides
 * what a section id means for its URLs.
 *
 * The Pages section keeps its own page tree (`PagesNav`, rendered by
 * `EditorShell` itself in `hideNav` mode) rather than this rail growing one
 * too — a deliberate simplification vs. meditor's single merged rail: two
 * thin rails side by side when Pages is active, one everywhere else, for a
 * fraction of the code (no page-tree duplication, no extra host data prop).
 */
export function SectionNav({
  sections,
  activeId,
  onSelect,
  dark,
  onToggleTheme,
}: Readonly<{
  sections: ResolvedSection[];
  activeId?: string;
  onSelect: (id: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
}>) {
  return (
    <nav
      aria-label="Sections"
      className="flex h-full w-14 shrink-0 flex-col items-center border-r border-[var(--typren-border)] bg-[var(--typren-bg)] py-2"
    >
      <ul className="flex flex-1 flex-col items-center gap-1">
        {groupSections(sections).map((group, i) => (
          <Fragment key={group.label}>
            {i > 0 && <li aria-hidden className="my-1 h-px w-6 bg-[var(--typren-border)]" />}
            {group.items.map((s) => {
              // `ResolvedSection.icon` is untyped (`unknown`) in core — a host
              // hands it an already-rendered node (React's equivalent of the
              // spec's "inline lucide svg"), never a component to instantiate.
              // Falls back to a kind-default lucide icon when omitted.
              const DefaultIcon = KIND_ICON[s.kind];
              const active = s.id === activeId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    title={s.label}
                    aria-label={s.label}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-md text-[var(--typren-muted-fg)] transition-colors",
                      active
                        ? "bg-[var(--typren-muted)] text-[var(--typren-fg)]"
                        : "hover:bg-[var(--typren-muted)] hover:text-[var(--typren-fg)]"
                    )}
                  >
                    {s.icon ? (s.icon as ReactNode) : <DefaultIcon className="size-4.5" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
      <button
        type="button"
        aria-label="Toggle editor theme"
        onClick={onToggleTheme}
        className="flex size-10 shrink-0 items-center justify-center rounded-md text-[var(--typren-muted-fg)] hover:bg-[var(--typren-muted)] hover:text-[var(--typren-fg)]"
      >
        {dark ? <Sun className="size-4.5" aria-hidden /> : <Moon className="size-4.5" aria-hidden />}
      </button>
    </nav>
  );
}
