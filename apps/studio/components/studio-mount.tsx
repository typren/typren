"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PageContent, PageInfo, SiteSettings, StudioProps } from "@typren/core";
import { createTyprenClient } from "@typren/core/api/client";
import { clientHost, TyprenStudio } from "@typren/studio";
import { navigatePage, pageAt, pathFor } from "@/lib/navigation";

/**
 * The studio's one client boundary: binds `TyprenStudioHost` to the content
 * API under `apiBase` and the studio's navigation to Next's router. All UI
 * is the studio's; host chrome goes in through its slots, never a shell here.
 * Takes everything as props, so a multi-site host can mount it per site.
 */
export function StudioMount({
  apiBase,
  pages,
  folders,
  slug,
  page,
  version,
  settings,
  settingsVersion,
  settingsHasDraft,
  homeSlug,
  ...site
}: Readonly<StudioProps & {
  /** Where `createTyprenApi` is mounted, e.g. "/api/typren". */
  apiBase: string;
}>) {
  const router = useRouter();
  // Read on the client: section and folder moves only push history (below),
  // so the server page, and everything it loads, doesn't re-run per click.
  // A server navigation would also remount the studio (the catch-all page is
  // keyed by its params) and cut the rail's slide short.
  const pathname = usePathname();
  const sectionId = pathname.split("/")[1] || undefined;
  const assetFolder = pathname.startsWith("/assets/") ? decodeURIComponent(pathname.slice("/assets/".length)) : "";
  const templatesView = pathname.split("/")[2] === "pages" ? "pages" : "sections";
  const actions = useMemo(() => createTyprenClient({ baseUrl: apiBase }), [apiBase]);
  const host = clientHost(actions, { ...site, homeSlug }, `${apiBase}/media`);
  // Picking a listed page or toggling `?edit` only pushes history too (see
  // `navigatePage`), so the page and edit mode follow the URL here and the
  // picked page's content is fetched on the client.
  const editing = useSearchParams().has("edit");
  const current = pageAt(pathname, pages, homeSlug);
  // The locale the viewer picked; undefined is the default one, which the
  // server render loads. Another locale's pages and settings are read here, and
  // the studio switches to it only once they have loaded, so it never writes
  // one locale's content under another.
  const [picked, setPicked] = useState<string>();
  const [localized, setLocalized] = useState<{
    locale: string;
    pages: PageInfo[];
    settings: SiteSettings;
    settingsVersion: string | null;
    settingsHasDraft: boolean;
  } | null>(null);
  useEffect(() => {
    if (!picked) return setLocalized(null);
    let live = true;
    Promise.all([actions.listPages(picked), actions.getSettings(picked)]).then(([p, s]) => {
      if (!live) return;
      // GET /settings carries its version and draft mark alongside the settings.
      const { version: v, hasDraft, ...rest } = s as SiteSettings & { version?: string | null; hasDraft?: boolean };
      setLocalized({ locale: picked, pages: p, settings: rest, settingsVersion: v ?? null, settingsHasDraft: hasDraft ?? false });
    }, () => {});
    return () => {
      live = false;
    };
    // A server render (`router.refresh`) reloads them too.
  }, [actions, picked, pages, settings]);
  const locale = localized?.locale;
  // A server render (first load, `router.refresh`) always wins.
  const [loaded, setLoaded] = useState<{ slug: string | null; page?: PageContent; version: string | null; locale?: string }>({
    slug,
    page,
    version,
  });
  // Other pages' content, read ahead once the studio is idle, so a page switch
  // renders with its content in the same pass instead of after a round trip
  // (the page canvas then shows it within a frame or two). Leaving a page
  // reads its copy again, since this tab may have edited it, and a server
  // render drops them all. A kept copy shows at once and is read again
  // behind it, replaced if its version moved (an edit outside this tab).
  // ponytail: one read per listed page per server render; a site with
  // hundreds of pages wants this limited to the pages near the open one.
  const ahead = useRef(new Map<string, { page: PageContent; version: string | null }>());
  const aheadKey = (s: string | null) => `${locale ?? ""}\n${s}`;
  useEffect(() => {
    ahead.current.clear();
    setLoaded({ slug, page, version });
  }, [slug, page, version]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      for (const p of localized?.pages ?? pages) {
        const key = `${locale ?? ""}\n${p.slug}`;
        if (!live || p.slug === current || ahead.current.has(key)) continue;
        const r = await actions.getPage(p.slug, locale).catch(() => null);
        if (r && live) ahead.current.set(key, { page: r.page, version: r.version });
      }
    }, 1500);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // Once per server render and locale; `current` only skips the open page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, pages, localized, locale]);
  // Whatever this tab edited on a page, its read-ahead copy predates it, so
  // leaving the page reads it again.
  useEffect(
    () => () => {
      const key = `${locale ?? ""}\n${current}`;
      ahead.current.delete(key);
      if (current) actions.getPage(current, locale).then((r) => void ahead.current.set(key, { page: r.page, version: r.version }), () => {});
    },
    [actions, current, locale]
  );
  const fetched = loaded.slug === current && loaded.locale === locale;
  // Read during render on purpose: the map only ever holds settled reads.
  const kept = fetched || !current ? undefined : ahead.current.get(aheadKey(current));
  useEffect(() => {
    if (!current || (current === loaded.slug && locale === loaded.locale)) return;
    let live = true;
    const show = (r: { page: PageContent; version: string | null }) => live && setLoaded({ slug: current, page: r.page, version: r.version, locale });
    // A kept copy keeps showing until this page is left, so it needs no
    // state of its own, which would only cost another render of the studio.
    actions.getPage(current, locale).then((r) => (!kept || r.version !== kept.version) && show(r), () => {});
    return () => {
      live = false;
    };
    // `kept` is read for the same `current` and locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, current, loaded.slug, loaded.locale, locale]);
  const shown = fetched ? loaded : kept;

  return (
    <TyprenStudio
      host={host}
      pages={localized?.pages ?? pages}
      folders={folders}
      slug={current}
      page={shown?.page}
      version={shown?.version ?? null}
      locale={locale}
      onLocaleChange={(l) => setPicked(l === settings.bootstrap.defaultLocale ? undefined : l)}
      settingsSnapshot={localized?.settings ?? settings}
      settingsVersion={localized ? localized.settingsVersion : settingsVersion}
      settingsHasDraft={localized ? localized.settingsHasDraft : settingsHasDraft}
      sectionId={sectionId}
      assetFolder={assetFolder}
      onNavigateAssetFolder={(f) => window.history.pushState(null, "", f ? `/assets/${f}` : "/assets")}
      templatesView={templatesView}
      onNavigateTemplatesView={(v) => window.history.pushState(null, "", v === "pages" ? `/${sectionId}/pages` : `/${sectionId}`)}
      onNavigateSection={(id) =>
        window.history.pushState(null, "", id === null ? "/" : id === "pages" ? `/pages/${current ?? homeSlug}` : `/${id}`)
      }
      editing={editing}
      onEditingChange={(on) => window.history.pushState(null, "", `${pathFor(current)}${on ? "?edit" : ""}`)}
      onNavigate={(next, how) => navigatePage(next, pages, router, how?.replace, how?.edit)}
      onReload={() => router.refresh()}
    />
  );
}
