"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { CollectionRecordInfo, CollectionSection, PageContent, PageInfo, ResolvedSection, SiteSettings } from "@typren/core";
import { CollectionPanel, type CollectionMode } from "./collection-panel";
import { EditorShell } from "./editor-shell";
import { MediaLibrarySection } from "./media-library";
import { PageList } from "./page-list";
import { cn } from "./primitives/cn";
import { SectionNav } from "./section-nav";
import { SettingsPanel } from "./settings-panel";
import type { TyprenEditorHost } from "./types";

/**
 * The SDUI admin shell: `SectionNav`'s single left rail plus whichever
 * section `activeId` names, filling one region — every built-in renderer
 * (`EditorShell`, `MediaLibrarySection`, `SettingsPanel`, `CollectionPanel`)
 * owns its own internal canvas/panel split, so this component never imposes
 * a second one. Ported (fresh, in React) from meditor's `<meditor-shell>`;
 * see `SectionNav`'s doc comment for the one deliberate layout simplification
 * (two rails when Pages is active, instead of merging the page tree into
 * this one).
 *
 * Owns the one shared dark-mode toggle (`localStorage["typren-theme"]`, same
 * key `EditorShell` reads/writes standalone) so every section shares a theme
 * instead of drifting independently — see `SectionNav`'s footer button.
 *
 * No routing inside this component, same doctrine as `EditorShell`/
 * `TyprenEditor`: `onSelectSection`/`onNavigatePage`/`onReload` report
 * intents, the host decides what they mean for its URLs.
 */
export function SectionShell({
  host,
  sections,
  activeId,
  onSelectSection,
  layout = "takeover",
  pages,
  slug,
  page,
  version,
  onNavigatePage,
  onReload,
  locale,
  collectionRecords,
  collectionMode,
  collectionSlug,
  onNavigateCollection,
  settingsSnapshot,
  settingsVersion,
}: Readonly<{
  host: TyprenEditorHost;
  sections: ResolvedSection[];
  /** Section id to render, e.g. from the host's own route segment. Falls
   *  back to the first resolved section when omitted or unknown. */
  activeId?: string;
  onSelectSection: (id: string) => void;
  /** Same contract as `TyprenEditorProps.layout`. */
  layout?: "takeover" | "embedded";
  pages: PageInfo[];
  slug?: string | null;
  page?: PageContent;
  version?: string | null;
  onNavigatePage: (slug: string | null) => void;
  onReload: () => void;
  locale?: string;
  /** Server-fetched rows per collection section, keyed by section id — core's
   *  `listCollectionRecords()` output, same "no client read action" shape as
   *  `TyprenEditorHost.collections`. */
  collectionRecords?: Record<string, CollectionRecordInfo[]>;
  /** `CollectionPanel`'s `mode`/`selectedSlug`/`onNavigate`, forwarded as-is —
   *  same "the host owns routing" doctrine as `slug`/`onNavigatePage` above,
   *  applied to Collection sections (e.g. a `?record=<slug>&mode=edit` URL).
   *  Omit all three to keep `CollectionPanel`'s own uncontrolled state. */
  collectionMode?: CollectionMode;
  collectionSlug?: string;
  onNavigateCollection?: (mode: CollectionMode, slug?: string) => void;
  /** Host-fetched settings snapshot + optimistic-lock version, forwarded to
   *  `SettingsPanel` as-is (see its doc comment for why these are data props,
   *  not part of `host`). */
  settingsSnapshot?: SiteSettings;
  settingsVersion?: string | null;
}>) {
  const [dark, setDark] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("typren-theme") === "dark"
  );
  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("typren-theme", dark ? "dark" : "light");
  }, [dark]);

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  let region: ReactNode = null;
  switch (active?.kind) {
    case "pages":
      region =
        slug && page ? (
          <EditorShell
            hideNav
            slug={slug}
            pages={pages}
            initialPage={page}
            initialVersion={version ?? null}
            sliceNames={host.sliceNames}
            defaults={host.defaults}
            fieldSchema={host.fieldSchema}
            previewPath={host.previewPath}
            actions={host.actions}
            media={host.media}
            icons={host.icons}
            topBarSlot={host.topBarSlot}
            locale={locale}
            onNavigate={onNavigatePage}
            onReload={onReload}
          />
        ) : (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <PageList pages={pages} onNavigate={onNavigatePage} />
          </div>
        );
      break;
    case "media":
      region = <MediaLibrarySection media={host.media} />;
      break;
    case "settings":
      region = (
        <SettingsPanel
          settings={host.settings}
          snapshot={settingsSnapshot}
          version={settingsVersion}
          media={host.media}
          locale={locale}
          onReload={onReload}
        />
      );
      break;
    case "collection":
      region = (
        <CollectionPanel
          section={active.raw as CollectionSection}
          actions={host.collections?.[active.id]}
          records={collectionRecords?.[active.id] ?? []}
          media={host.media}
          icons={host.icons}
          locale={locale}
          onReload={onReload}
          mode={collectionMode}
          selectedSlug={collectionSlug}
          onNavigate={onNavigateCollection}
        />
      );
      break;
    case "custom":
      // No plugin runtime here (see docs/hosted-platform.md's "custom
      // sections ship code") — say so loudly rather than paint an empty pane.
      region = (
        <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center text-sm text-[var(--typren-muted-fg)]">
          &ldquo;{active.label}&rdquo; is a custom section. @typren/editor has no plugin runtime to render it — the
          host is responsible for its own routing/UI around this section.
        </div>
      );
      break;
  }

  return (
    <div
      className={cn(
        "flex bg-[var(--typren-bg)] text-[var(--typren-fg)]",
        layout === "embedded" ? "h-full min-h-0" : "fixed inset-0 z-[100]",
        dark && "dark"
      )}
    >
      <SectionNav
        sections={sections}
        activeId={active?.id}
        onSelect={onSelectSection}
        dark={dark}
        onToggleTheme={() => setDark((v) => !v)}
      />
      {region}
    </div>
  );
}
