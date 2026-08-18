"use client";

import type { Messages, PageContent, PageInfo } from "@typren/core";
import { CmsIntlProvider } from "./intl";
import { EditorShell } from "./editor-shell";
import { PagesNav } from "./pages-nav";
import { PageList } from "./page-list";
import type { TyprenEditorHost } from "./types";

export type { TyprenEditorHost };

/**
 * The one component a host mounts. It owns no router of its own. `slug`
 * (which page is open, or `null`/undefined for the page picker) is a prop,
 * and every navigation outcome (create, delete, click a page row) is reported
 * via `onNavigate` instead of being applied to `window.location` here. The
 * host decides what a slug means for its URLs; no routing lives inside the
 * library.
 *
 * Settings/media-library/collections/onboarding sections aren't built yet;
 * this component only ever renders the Pages editing loop: the page picker
 * when no page is open, or the full block/field/preview shell once one is.
 */
export interface TyprenEditorProps {
  host: TyprenEditorHost;
  pages: PageInfo[];
  /** Slug of the page being edited, or `null`/undefined for the page picker. */
  slug?: string | null;
  /** Required alongside `slug`: the page's content as of `version`. Omitting
   *  it (e.g. still loading) falls back to the page picker rather than
   *  rendering a half-populated shell. */
  page?: PageContent;
  /** Optimistic-lock version `page` was loaded at (see `PageActions.saveDraft`). */
  version?: string | null;
  /** Content locale for reads/writes (single-locale hosts omit this). */
  locale?: string;
  onNavigate: (slug: string | null) => void;
  /** See `EditorShell`'s `onReload`: refresh "this page" after a
   *  discard/publish/conflict-reload, however the host's router does that. */
  onReload: () => void;
  /** Host overrides for the editor UI's strings, deep-merged onto the
   *  package's English defaults. */
  messages?: Partial<Messages>;
}

export function TyprenEditor({
  host,
  pages,
  slug,
  page,
  version = null,
  locale,
  onNavigate,
  onReload,
  messages,
}: Readonly<TyprenEditorProps>) {
  return (
    <CmsIntlProvider messages={messages}>
      {slug && page ? (
        <EditorShell
          slug={slug}
          pages={pages}
          initialPage={page}
          initialVersion={version}
          sliceNames={host.sliceNames}
          defaults={host.defaults}
          fieldSchema={host.fieldSchema}
          previewPath={host.previewPath}
          actions={host.actions}
          media={host.media}
          icons={host.icons}
          locale={locale}
          onNavigate={onNavigate}
          onReload={onReload}
        />
      ) : (
        <div className="fixed inset-0 z-[100] flex bg-[var(--typren-bg)] text-[var(--typren-fg)]">
          <PagesNav
            pages={pages}
            onCreate={host.actions.createPage}
            onDelete={host.actions.deletePage}
            onNavigate={onNavigate}
          />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <PageList pages={pages} onNavigate={onNavigate} />
          </main>
        </div>
      )}
    </CmsIntlProvider>
  );
}
