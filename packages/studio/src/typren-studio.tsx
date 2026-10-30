"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SharedMediaProvider } from "./image-picker-field";
import { MediaOriginProvider, siteOrigin } from "./media-url";
import type {
  CollectionRecordInfo,
  CollectionSection,
  Messages,
  PageContent,
  MediaAsset,
  PageInfo,
  PageTemplate,
  ResolvedSection,
  Section,
  SiteSettings,
  Slice,
} from "@typren/core";
import { SITE_SLUG, resolveSections } from "@typren/core";
import { CollectionPanel, type CollectionMode } from "./collection-panel";
import {
  DevicePreview,
  fromFrame,
  postToFrame,
  type Device,
} from "./device-preview";
import { Frame, type SearchHit } from "./frame";
import { TopBarButton } from "./primitives/top-bar-button";
import { CmsIntlProvider, useT } from "./intl";
import { Construction, MousePointerClick, PencilLine } from "lucide-react";
import { useStoredChoice } from "./use-stored-choice";
import { AssetViewToggle, type AssetView } from "./asset-browser";
import { MediaLibrarySection, uploadAssets } from "./media-library";
import { NavLevel, NavPanel, useNavDraft } from "./nav-panel";
import { NewPageWizard } from "./new-page-wizard";
import { usePageEditor } from "./page-editor";
import { underPrefix, useCanvasDocument, usePageCanvas } from "./page-canvas";
import { ReviewPanel, SETTINGS_DRAFT } from "./review-panel";
import { PageTemplatesLibrary } from "./page-templates";
import { SectionsLibrary, probeSectionRoute } from "./sections-library";
import {
  RUNTIME_SCHEMA,
  SettingsPanel,
  useSettingsDraft,
} from "./settings-panel";
import {
  StyleLevel,
  StylePanel,
  useStyleDraft,
  type StyleScreenId,
} from "./style-panel";
import {
  AssetsLevel,
  PagesLevel,
  SiteLevel,
  TemplatesLevel,
  type TemplatesView,
} from "./site-rail";
import { EmptyState } from "./primitives/empty";
import { ScrollArea } from "./primitives/scroll-area";
import type { TyprenStudioHost } from "./types";

export type { TyprenStudioHost };

/** A host that configures no sections gets Website → Pages only. */
const DEFAULT_RAIL: Section[] = [
  { kind: "pages", label: "Pages", group: "website" },
];

/** What edit mode starts from while no page has loaded; it never enables then. */
const NO_PAGE: PageContent = { meta: {}, slices: [], body: "" };

/** Every string in a page's content, for search. Markdown emphasis is
 *  stripped so "**fast**" matches "fast". */
export function pageText(page: PageContent): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v.replaceAll("**", ""));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(page.slices);
  walk(page.body);
  return out.join(" ");
}

/** Preview iframe `src` for a page. `host.previewUrl` may return an absolute,
 *  cross-origin URL with its own query string, so the cache-buster and locale
 *  are appended rather than assuming a bare path. */
export function previewSrc(
  host: TyprenStudioHost,
  slug: string,
  reloadKey: number,
  locale?: string,
): string {
  const base = host.previewUrl?.(slug) ?? `${host.previewPath}/${slug}`;
  return `${base}${base.includes("?") ? "&" : "?"}v=${reloadKey}${locale ? `&locale=${encodeURIComponent(locale)}` : ""}`;
}

/** The listed page whose preview URL has `path` as its path: `previewSrc` in
 *  reverse, ignoring a trailing slash on either side. Null when none does. */
export function slugAtPath(
  host: TyprenStudioHost,
  pages: PageInfo[],
  path: string,
): string | null {
  const bare = (p: string) => p.replace(/\/+$/, "");
  const want = bare(path);
  const at = (slug: string) =>
    new URL(
      host.previewUrl?.(slug) ?? `${host.previewPath}/${slug}`,
      "http://preview.invalid",
    ).pathname;
  return pages.find((p) => bare(at(p.slug)) === want)?.slug ?? null;
}

/**
 * The one component a host mounts: the v3 drill-down shell (see
 * docs/editor-v3.md). It owns no router. `slug` and `sectionId` are props and
 * every navigation outcome is reported through `onNavigate`/
 * `onNavigateSection`/`onNavigateCollection`; the host decides what they mean
 * for its URLs. Rail depth and browse/edit mode are UI state and live here.
 *
 * The root fills its parent (`h-full`), so the host's mount point needs a
 * definite height. Popups and dialogs portal into the Frame root.
 */
export interface TyprenStudioProps {
  host: TyprenStudioHost;
  pages: PageInfo[];
  /** Page folders kept without pages, for the Pages rail's tree. */
  folders?: string[];
  /** Page being previewed (and edited, once in edit mode), or null for none. */
  slug?: string | null;
  /** `slug`'s content as of `version`. Edit mode needs it; without it the
   *  page can be previewed but Edit stays disabled. */
  page?: PageContent;
  /** Optimistic-lock version `page` was loaded at (see `PageActions.saveDraft`). */
  version?: string | null;
  /** Content locale for reads/writes (single-locale hosts omit this). */
  locale?: string;
  /** The viewer picked another of the site's locales (the settings
   *  snapshot's `bootstrap.locales`), or a remembered pick was restored; the
   *  host loads that locale's content and passes it back as `locale`. The
   *  top bar's locale switcher shows only with this and two or more locales. */
  onLocaleChange?: (locale: string) => void;
  /** `replace` marks a move the preview frame made itself (a link clicked
   *  inside it), which already added a history entry of its own. `edit`
   *  opens the page in edit mode (a page the new-page wizard just made), for
   *  hosts that keep `editing` in the URL. */
  onNavigate: (
    slug: string | null,
    how?: { replace?: boolean; edit?: boolean },
  ) => void;
  /** Refresh the host's data after a discard/publish/conflict-reload. */
  onReload: () => void;
  /** Host overrides for the studio UI's strings, merged onto the English defaults. */
  messages?: Partial<Messages>;
  /** Edit mode for `slug`, for hosts that keep it in the URL; omit both to
   *  keep it internal. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Assets folder shown ("" for the top level), for hosts that keep it in
   *  the URL; omit both to keep it internal. */
  assetFolder?: string;
  onNavigateAssetFolder?: (folder: string) => void;
  /** Which kind of template Templates shows, for hosts that keep it in the
   *  URL; omit both to keep it internal. */
  templatesView?: TemplatesView;
  onNavigateTemplatesView?: (view: TemplatesView) => void;
  /** Active rail entry id; defaults to the first resolved section. */
  sectionId?: string;
  /** A rail entry was opened, or `null` when the user went back to the site
   *  level. */
  onNavigateSection?: (id: string | null) => void;
  /** Server-fetched rows per collection section, keyed by section id. */
  collectionRecords?: Record<string, CollectionRecordInfo[]>;
  /** `CollectionPanel`'s controlled state, forwarded as-is; omit all three
   *  to keep it uncontrolled. */
  collectionMode?: CollectionMode;
  collectionSlug?: string;
  onNavigateCollection?: (mode: CollectionMode, slug?: string) => void;
  /** Settings snapshot for the Settings entry; its `brand.name` is the site
   *  name at rail level 0. */
  settingsSnapshot?: SiteSettings;
  /** Optimistic-lock version `settingsSnapshot` was loaded at. */
  settingsVersion?: string | null;
  /** `settingsSnapshot` is the settings doc's draft, not published (pushed) yet. */
  settingsHasDraft?: boolean;
}

export function TyprenStudio(props: Readonly<TyprenStudioProps>) {
  return (
    <CmsIntlProvider messages={props.messages}>
      <MediaOriginProvider origin={siteOrigin(props.host)}>
        <SharedMediaProvider value={props.host.sharedMedia}>
          <Shell {...props} />
        </SharedMediaProvider>
      </MediaOriginProvider>
    </CmsIntlProvider>
  );
}

function Shell({
  host,
  pages,
  folders,
  slug,
  page,
  version = null,
  locale,
  onLocaleChange,
  onNavigate,
  onReload,
  editing: editingProp,
  onEditingChange,
  assetFolder,
  onNavigateAssetFolder,
  templatesView: templatesViewProp,
  onNavigateTemplatesView,
  sectionId,
  onNavigateSection,
  collectionRecords,
  collectionMode,
  collectionSlug,
  onNavigateCollection,
  settingsSnapshot,
  settingsVersion,
  settingsHasDraft = false,
}: Readonly<TyprenStudioProps>) {
  const t = useT();
  const sections = resolveSections({
    sections: host.sections?.length ? host.sections : DEFAULT_RAIL,
  });
  // The host updates `sectionId` a render after a click. Until it does, the
  // chosen section is held here so level and section change in one render and
  // the rail slides once; null means "none".
  const [chosen, setChosen] = useState<string | null | undefined>();
  useEffect(() => setChosen(undefined), [sectionId]);
  const currentId = chosen === undefined ? sectionId : chosen;
  const active = sections.find((s) => s.id === currentId) ?? sections[0];
  const homeSlug = host.homeSlug ?? "home";

  // Pages, Assets, Templates and Style drill to level 1, but only when chosen; with
  // no section picked the rail starts at the site, previewing the first entry.
  const isStyle = active.kind === "custom" && active.id === "style";
  const isNav = active.kind === "custom" && active.id === "navigation";
  const drills =
    active.kind === "pages" ||
    active.kind === "media" ||
    active.kind === "library" ||
    isStyle ||
    isNav;
  const [level, setLevel] = useState<0 | 1>(currentId && drills ? 1 : 0);
  useEffect(() => {
    setLevel(currentId && drills ? 1 : 0);
  }, [currentId, drills]);
  const [folder, setFolder] = useState(assetFolder ?? "");
  useEffect(() => {
    if (assetFolder !== undefined) setFolder(assetFolder);
  }, [assetFolder]);
  const openFolder = (f: string) => {
    setFolder(f);
    onNavigateAssetFolder?.(f);
  };
  const [editing, setEditingState] = useState(editingProp ?? false);
  useEffect(() => {
    if (editingProp !== undefined) setEditingState(editingProp);
  }, [editingProp]);
  const setEditing = (v: boolean) => {
    setEditingState(v);
    onEditingChange?.(v);
  };
  // Warm the site's section route (a dev server compiles it on first hit) once
  // the first screen has loaded, so Templates opens onto a ready route.
  const sectionPreviewUrl = host.sectionPreviewUrl;
  useEffect(() => {
    if (!sectionPreviewUrl) return;
    const t = setTimeout(() => void probeSectionRoute(sectionPreviewUrl, window.location.origin), 2000);
    return () => clearTimeout(t);
  }, [sectionPreviewUrl]);
  const [device, setDevice] = useState<Device>("desktop");
  const [templatesView, setTemplatesView] = useState<TemplatesView>(
    templatesViewProp ?? "sections",
  );
  useEffect(() => {
    if (templatesViewProp !== undefined) setTemplatesView(templatesViewProp);
  }, [templatesViewProp]);
  // The template folder shown, and a revision both template panes reload
  // on, since the rail and the browser each change the same lists.
  const [templateFolder, setTemplateFolder] = useState("");
  const [libraryRev, setLibraryRev] = useState(0);
  const bumpLibrary = () => setLibraryRev((n) => n + 1);
  const openTemplatesView = (v: TemplatesView, f = "") => {
    setTemplateFolder(f);
    setTemplatesView(v);
    onNavigateTemplatesView?.(v);
  };
  const [wizard, setWizard] = useState<{ template?: PageTemplate } | null>(
    null,
  );
  const [styleScreen, setStyleScreen] = useState<StyleScreenId>("colors");
  // Local studio: one Review panel for every entry's Review button; `gitRev`
  // moves after it pushed or discarded, for the page editor's pending count.
  const [reviewing, setReviewing] = useState(false);
  const [gitRev, setGitRev] = useState(0);
  const onReview = () => setReviewing(true);
  const pagesDrafted = pages.some((p) => p.hasDraft);
  // Navigation loads only while open; its hook keeps what it learned after.
  const [navDrafted, setNavDrafted] = useState(false);
  // Settings and Style edit one doc, so they share one draft.
  const settingsDraft = useSettingsDraft({
    host,
    snapshot: settingsSnapshot,
    version: settingsVersion,
    drafted: settingsHasDraft,
    locale,
    gitRev,
    otherDrafts: pagesDrafted || navDrafted,
    onReload,
    onReview,
  });
  const styleDraft = useStyleDraft({ draft: settingsDraft, styleMap: host.styleMap });
  const navDraft = useNavDraft({
    host,
    enabled: isNav,
    locale,
    gitRev,
    otherDrafts: pagesDrafted || settingsDraft.drafted,
    onReload,
    onReview,
  });
  if (navDraft.drafted !== navDrafted) setNavDrafted(navDraft.drafted);
  // A page switch clears `page` until the next one loads; disabling Edit for
  // that moment made it flicker. It stays enabled once any page has loaded, and
  // a click in the gap opens edit mode as soon as the page arrives.
  const pageSeen = useRef(false);
  if (page) pageSeen.current = true;
  // Null until Assets first loads, so its browser can hold a skeleton.
  const [library, setLibrary] = useState<{
    assets: MediaAsset[];
    folders?: string[];
  } | null>(null);
  const [assetView, setAssetView] = useStoredChoice<AssetView>(
    "typren-asset-view",
    "gallery",
    ["gallery", "list"],
  );
  const [sectionView, setSectionView] = useStoredChoice<AssetView>(
    "typren-section-view",
    "gallery",
    ["gallery", "list"],
  );
  const [content, setContent] = useState<Record<string, string>>({});
  const searchLoaded = useRef(false);
  const sectionOf = (kind: ResolvedSection["kind"]) =>
    sections.find((s) => s.kind === kind);
  // One list for the rail, the grid and search; every change reloads it.
  const loadLibrary = async () => {
    if (!host.media || !sectionOf("media")) return;
    const [assets, folders] = await Promise.all([
      host.media.list(),
      host.media.folders?.list(),
    ]);
    setLibrary({ assets, folders });
  };
  useEffect(() => {
    if (active.kind === "media") void loadLibrary().catch(() => {});
    // Reload on entering Assets only; edits inside it call loadLibrary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.kind]);
  const moveAsset = async (id: string, to: string) => {
    await host.media?.folders?.move(id, to);
    await loadLibrary();
  };
  const [theme, setTheme] = useStoredChoice("typren-theme", "light", [
    "light",
    "dark",
  ]);
  const dark = theme === "dark";

  const info = slug ? pages.find((p) => p.slug === slug) : undefined;
  const pill = slug && {
    title: info?.title ?? slug,
    url: slug === homeSlug ? "/" : `/${slug}`,
  };
  const bootstrap = settingsSnapshot?.bootstrap;
  const siteLocales = bootstrap?.locales ?? [];
  const shownLocale = locale ?? bootstrap?.defaultLocale ?? "";
  const [localeChoice, chooseLocale] = useStoredChoice("typren-locale", shownLocale, siteLocales);
  // The viewer's choice drives the host: a remembered one once it is read,
  // then each pick. A host-side locale change doesn't overwrite it.
  useEffect(() => {
    if (localeChoice && localeChoice !== shownLocale) onLocaleChange?.(localeChoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localeChoice]);
  const common = {
    localeSwitch:
      onLocaleChange && siteLocales.length > 1
        ? {
            value: shownLocale,
            locales: siteLocales,
            // Picking the remembered locale again (the host moved off it) re-sends it.
            onChange: (l: string) => (l === localeChoice ? onLocaleChange(l) : chooseLocale(l)),
          }
        : undefined,
    onDevice: setDevice,
    topBarSlot: host.topBarSlot,
    dark,
    onToggleTheme: () => setTheme(dark ? "light" : "dark"),
  };

  // One preview frame for browse and edit mode, so toggling Edit never
  // reloads it. Browsing follows the visitor's own clicks through the site:
  // the pill, rail and host URL move, but the frame keeps the src it loaded,
  // since a new src would reload it. `src` is the page the frame was sent to,
  // `at` where it says it is, and `n` counts sends and reloads, keying the
  // frame. Only a `slug` change to somewhere the frame is not sends it again.
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameAt, setFrameAt] = useState({ slug, src: slug, at: slug, n: 0 });
  if (slug !== frameAt.slug)
    setFrameAt(
      slug === frameAt.at
        ? { ...frameAt, slug }
        : { slug, src: slug, at: slug, n: frameAt.n + 1 },
    );
  const reloadPreview = () =>
    setFrameAt((f) => ({ ...f, src: f.at, n: f.n + 1 }));
  // A frame mounted again (back from another section) loads where it was.
  const previewing = active.kind === "pages" && Boolean(slug);
  useEffect(() => {
    if (!previewing)
      setFrameAt((f) => (f.src === f.at ? f : { ...f, src: f.at }));
  }, [previewing]);

  // The persistent page canvas (docs/canvas-renderer.md): loaded beside the
  // real-route frame once the pages section shows, it follows the page as
  // the studio holds it and takes over the preview in edit mode, so page
  // switches, edits and locale switches there need no reload. Browse mode
  // and pages under a nested layout stay on the real route.
  const nested = underPrefix(slug === homeSlug ? "/" : `/${slug ?? ""}`, host.nestedLayouts);
  const canvas = usePageCanvas({ url: host.sectionPreviewUrl, mounted: previewing });
  const canvasOn = canvas.ready && Boolean(editing) && !nested;
  // While the canvas edits, the real-route frame behind it holds still: it
  // shares the studio's renderer process on a local site, so reloading it
  // hidden on every page switch, save or locale switch stalled the canvas
  // by a few hundred milliseconds. It catches up when the canvas steps aside.
  const realFrame = { src: previewSrc(host, frameAt.src ?? slug ?? "", frameAt.n, locale), n: frameAt.n };
  const [heldFrame, setHeldFrame] = useState(realFrame);
  if (!canvasOn && (heldFrame.src !== realFrame.src || heldFrame.n !== realFrame.n)) setHeldFrame(realFrame);

  const edit = usePageEditor({
    enabled: Boolean(editing && previewing && page && pill),
    host,
    slug: slug ?? "",
    pill: { title: pill ? pill.title : "", url: pill ? pill.url : "", hasDraft: info?.hasDraft ?? false },
    otherDrafts: pages.filter((p) => p.hasDraft && p.slug !== slug),
    initialPage: page ?? NO_PAGE,
    initialVersion: version,
    locale,
    iframeRef: canvasOn ? canvas.frameRef : frameRef,
    onReloadPreview: reloadPreview,
    onExit: () => setEditing(false),
    onReload,
    localeSwitch: common.localeSwitch,
    onReview,
    gitRev,
  });
  useCanvasDocument(canvas, { slug, locale, slices: nested ? undefined : (edit?.page ?? page)?.slices });
  // The frame's bridge follows the mode: an edit canvas, or the live site
  // with its own links working. A frame that loads later asks with its
  // `location` post, answered below. With the page canvas editing, the
  // real-route frame stays browsing behind it.
  const editMode = Boolean(edit);
  const realEdit = editMode && !canvasOn;
  useEffect(() => {
    postToFrame(frameRef.current, {
      __typren: true,
      type: realEdit ? "edit" : "browse",
    });
    // The canvas is always an edit canvas; `edit` asks it for fresh geometry.
    if (canvasOn) postToFrame(canvas.frameRef.current, { __typren: true, type: "edit" });
    if (!realEdit) return;
    // A site on an older bridge ignores `edit` and posts no rects for it; a
    // fresh load of its frame starts as an edit canvas. ponytail: rects
    // posted by a scroll in that window pass for an answer; the page
    // canvas's hello settles it for sites that serve one.
    let answered = false;
    const onRects = (e: MessageEvent) => {
      if (fromFrame(e, frameRef.current) && e.data?.__typren === true && e.data.type === "rects") answered = true;
    };
    window.addEventListener("message", onRects);
    const t = setTimeout(() => answered || reloadPreview(), 500);
    return () => {
      clearTimeout(t);
      window.removeEventListener("message", onRects);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mode is the trigger.
  }, [realEdit, canvasOn]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Identified by source and origin, as in usePageEditor.
      const frame = frameRef.current;
      if (!frame || !fromFrame(e, frame)) return;
      const d = e.data;
      if (d?.__typren !== true || d.type !== "location") return;
      if (
        typeof d.path !== "string" ||
        !d.path.startsWith("/") ||
        d.path.length > 2048
      )
        return;
      // An edit canvas keeps its clicks, so it cannot have moved.
      if (editMode) return;
      // Only browsing here, so the site's own links should work.
      postToFrame(frame, { __typren: true, type: "browse" });
      const to = slugAtPath(host, pages, d.path);
      // ponytail: a path that is no listed page leaves the pill as it was.
      if (!to || to === slug) return;
      setFrameAt((f) => ({ ...f, at: to }));
      onNavigate(to, { replace: true });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  const open = (s: ResolvedSection) => {
    setChosen(s.id);
    onNavigateSection?.(s.id);
    if (
      s.kind === "pages" ||
      s.kind === "media" ||
      s.kind === "library" ||
      (s.kind === "custom" && (s.id === "style" || s.id === "navigation"))
    )
      setLevel(1);
  };
  const atPages = active.kind === "pages" && level === 1;
  const atAssets = active.kind === "media" && level === 1;
  const atTemplates = active.kind === "library" && level === 1;
  const atStyle = isStyle && level === 1;
  const atNav = isNav && level === 1;

  /** The wizard's Create: the draft page with its sections, then that page
   *  open in edit mode. */
  const createFromWizard = async (
    title: string,
    at: string,
    slices: Slice[],
  ) => {
    const created = await host.actions.createPageFrom(
      title,
      at,
      slices,
      locale,
    );
    setWizard(null);
    const pagesSection = sectionOf("pages");
    if (pagesSection) setChosen(pagesSection.id);
    setLevel(1);
    onNavigate(created, { edit: true });
    if (editingProp === undefined) setEditingState(true);
  };

  // ponytail: one read per page the first time search opens, and not
  // refreshed after edits until a reload. A server-side index is the upgrade
  // once sites outgrow a few dozen pages.
  const loadSearch = () => {
    if (searchLoaded.current) return;
    searchLoaded.current = true;
    void loadLibrary().catch(() => {});
    const read = host.readPage;
    if (read)
      void Promise.all(
        pages.map((p) =>
          read(p.slug).then(
            (c) => [p.slug, pageText(c)] as const,
            () => [p.slug, ""] as const,
          ),
        ),
      ).then((entries) => setContent(Object.fromEntries(entries)));
  };
  const settingValue = (key: string) => {
    const v = key
      .split(".")
      .reduce<unknown>(
        (o, k) => (o as Record<string, unknown> | undefined)?.[k],
        settingsSnapshot,
      );
    return typeof v === "string" ? v : undefined;
  };
  const hits: SearchHit[] = [
    ...sections.map((s) => ({
      id: `section:${s.id}`,
      group: "Go to",
      label: s.label,
    })),
    ...pages.map((p) => ({
      id: `page:${p.slug}`,
      group: "Pages",
      label: p.title,
      hint: p.slug === homeSlug ? "/" : `/${p.slug}`,
      text: content[p.slug],
    })),
    ...(library?.assets ?? []).map((a) => ({
      id: `asset:${a.id}`,
      group: "Assets",
      label: a.name,
      hint: a.folder || undefined,
    })),
    ...(sectionOf("settings")
      ? Object.entries(RUNTIME_SCHEMA).map(([key, f]) => ({
          id: `setting:${key}`,
          group: "Settings",
          label: f.label ?? key,
          hint: settingValue(key),
        }))
      : []),
  ];
  // In edit mode a page pick keeps editing (on the canvas, a new document
  // rather than a reload); any other pick leaves edit mode first. Both drop
  // this page's unsaved edits, so they ask first.
  const pickHit = async (hit: Pick<SearchHit, "id">) => {
    const sep = hit.id.indexOf(":");
    const kind = hit.id.slice(0, sep);
    const key = hit.id.slice(sep + 1);
    if (edit && !(await edit.confirmLeave())) return;
    if (isNav && !(await navDraft.leave())) return;
    if (kind === "page") {
      const pagesSection = sectionOf("pages");
      if (pagesSection && active.id !== pagesSection.id) {
        setChosen(pagesSection.id);
        onNavigateSection?.(pagesSection.id);
      }
      setLevel(1);
      if (edit) onNavigate(key, { edit: true });
      else onNavigate(key);
      return;
    }
    if (edit) setEditing(false);
    const target =
      kind === "section"
        ? sections.find((s) => s.id === key)
        : sectionOf(kind === "asset" ? "media" : "settings");
    if (target) open(target);
    if (kind === "asset")
      openFolder(library?.assets.find((a) => a.id === key)?.folder ?? "");
  };

  let main: ReactNode;
  switch (active.kind) {
    case "pages":
      main = slug ? (
        <DevicePreview
          src={canvasOn ? heldFrame.src : realFrame.src}
          device={device}
          reloadKey={canvasOn ? heldFrame.n : realFrame.n}
          iframeRef={frameRef}
          canvas={canvas.keep ? { src: canvas.src!, nonce: canvas.nonce, ref: canvas.frameRef, shown: canvasOn } : undefined}
        >
          {edit?.overlay}
        </DevicePreview>
      ) : (
        <Panel>
          <EmptyState icon={<MousePointerClick />} title={t("nav.selectToEdit")} />
        </Panel>
      );
      break;
    case "media":
      main = (
        <MediaLibrarySection
          media={host.media}
          ready={!!library}
          assets={library?.assets}
          folders={library?.folders}
          folder={folder}
          view={assetView}
          onOpenFolder={openFolder}
          onOpenPage={(slug) =>
            pickHit({ id: slug === "settings" ? "settings:" : `page:${slug}` })
          }
          onChange={loadLibrary}
        />
      );
      break;
    case "library":
      main =
        templatesView === "pages" ? (
          <PageTemplatesLibrary
            host={host}
            view={sectionView}
            folder={templateFolder}
            rev={libraryRev}
            onOpenFolder={(f) => openTemplatesView("pages", f)}
            onChange={bumpLibrary}
            onNewPage={(template) => setWizard({ template })}
          />
        ) : (
          <SectionsLibrary
            host={host}
            pages={pages}
            view={sectionView}
            folder={templateFolder}
            rev={libraryRev}
            onOpenFolder={(f) => openTemplatesView("sections", f)}
            onChange={bumpLibrary}
            locale={locale}
            onOpenPage={(slug) => pickHit({ id: `page:${slug}` })}
            onInserted={onReload}
          />
        );
      break;
    case "settings":
      main = (
        <SettingsPanel
          settings={host.settings}
          draft={settingsDraft}
          snapshot={settingsSnapshot}
          version={settingsVersion}
          media={host.media}
          locale={locale}
          onReload={onReload}
        />
      );
      break;
    case "collection":
      main = (
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
      // sections ship code"), so say so rather than paint an empty pane.
      main =
        active.id === "style" ? (
          <StylePanel
            screen={styleScreen}
            draft={styleDraft}
            previewSrc={previewSrc(host, homeSlug, 0, locale)}
            device={device}
          />
        ) : isNav ? (
          <NavPanel
            draft={navDraft}
            pages={pages}
            homeSlug={homeSlug}
            previewSrc={(v) => previewSrc(host, homeSlug, v, locale)}
            device={device}
          />
        ) : (active.raw as { host?: true }).host && host.renderSection?.(active.id) != null ? (
          <ScrollArea className="min-h-0 flex-1">{host.renderSection(active.id)}</ScrollArea>
        ) : (
          <EmptyState
            icon={<Construction />}
            title={`${active.label} isn’t available in the studio yet.`}
          />
        );
      break;
  }

  return (
    <Frame
      {...common}
      title={active.label}
      level={level}
      view={
        atAssets
          ? "assets"
          : atPages
            ? "pages"
            : atTemplates
              ? "templates"
              : atStyle
                ? "style"
                : atNav
                  ? "navigation"
                  : ""
      }
      screen={
        active.kind === "pages"
          ? "preview"
          : active.kind === "library"
            ? `${active.id}:${templatesView}`
            : isStyle
              ? `style:${styleScreen}`
              : active.id
      }
      back={
        atPages || atAssets || atTemplates || atStyle || atNav
          ? {
              label: "Website",
              onBack: async () => {
                if (atNav && !(await navDraft.leave())) return;
                setLevel(0);
                setChosen(null);
                onNavigateSection?.(null);
              },
            }
          : host.exit
            ? { label: host.exit.label, onBack: host.exit.onExit }
            : null
      }
      device={
        active.kind === "pages" ||
        (isNav && (navDraft.ready || navDraft.loading))
          ? device
          : undefined
      }
      controls={
        active.kind === "media" ? (
          <AssetViewToggle view={assetView} onChange={setAssetView} />
        ) : (
          active.kind === "library" && (
            <AssetViewToggle view={sectionView} onChange={setSectionView} />
          )
        )
      }
      pill={
        active.kind === "pages" && pill
          ? {
              ...pill,
              status:
                info?.published === false
                  ? "Draft"
                  : info?.hasDraft
                    ? "Unpublished changes"
                    : "Published",
            }
          : undefined
      }
      search={{ hits, onOpen: loadSearch, onPick: (hit) => void pickHit(hit) }}
      banner={
        isStyle
          ? styleDraft.banner
          : isNav
            ? navDraft.banner
            : active.kind === "settings"
              ? settingsDraft.banner
              : undefined
      }
      actions={
        isStyle
          ? styleDraft.actions
          : isNav
            ? navDraft.actions
            : active.kind === "settings"
              ? settingsDraft.actions
              : active.kind === "pages" &&
                slug && (
                  <TopBarButton
                    label="Edit"
                    aria-pressed={editMode}
                    aria-controls={editMode ? "typren-edit-row" : undefined}
                    disabled={!pageSeen.current}
                    onClick={edit ? edit.leave : () => setEditing(true)}
                  >
                    <PencilLine aria-hidden />
                  </TopBarButton>
                )
      }
      rail={
        atPages ? (
          <PagesLevel
            pages={pages}
            folders={folders}
            currentSlug={slug}
            homeSlug={homeSlug}
            onNew={() => setWizard({})}
            onDelete={host.actions.deletePage}
            onDeleteFolder={
              host.pageFolders &&
              ((f) => host.pageFolders!.delete(f).then(onReload))
            }
            onNavigate={onNavigate}
            settingsIO={
              host.getPage && {
                load: host.getPage,
                saveTemplate:
                  host.library?.templates &&
                  ((name, slices) =>
                    host.library!.templates!.save(name, slices)),
                updateMeta: (s, patch, v) =>
                  host.actions
                    .updatePageMeta(s, patch, v ?? undefined)
                    .then((r) => (r.ok && onReload(), r)),
                rename:
                  host.renamePage &&
                  ((s, to) =>
                    host.renamePage!(s, to).then(
                      (r) => (r.ok && onReload(), r),
                    )),
              }
            }
          />
        ) : atAssets ? (
          <AssetsLevel
            folders={library?.folders}
            assets={library?.assets ?? []}
            current={folder}
            onOpen={openFolder}
            onCreate={
              host.media?.folders &&
              (async (f) => {
                await host.media!.folders!.create(f);
                await loadLibrary();
              })
            }
            onDelete={
              host.media?.folders &&
              (async (f) => {
                await host.media!.folders!.delete(f);
                await loadLibrary();
              })
            }
            onRename={
              host.media?.folders &&
              (async (f, to) => {
                await host.media!.folders!.rename(f, to);
                await loadLibrary();
              })
            }
            onUpload={(files) =>
              void (
                host.media &&
                uploadAssets(host.media, files, folder).then(() =>
                  loadLibrary(),
                )
              )
            }
            onMove={host.media?.folders && ((id, to) => void moveAsset(id, to))}
          />
        ) : atTemplates ? (
          <TemplatesLevel
            current={templatesView}
            folder={templateFolder}
            pages={!!host.library?.templates}
            library={host.library}
            builtIns={host.sliceNames.length}
            rev={libraryRev}
            onChange={bumpLibrary}
            onOpen={openTemplatesView}
          />
        ) : atStyle ? (
          <StyleLevel current={styleScreen} onOpen={setStyleScreen} />
        ) : atNav ? (
          <NavLevel draft={navDraft} />
        ) : (
          <SiteLevel
            siteName={settingsSnapshot?.brand.name}
            sections={sections}
            activeId={active.id}
            onOpen={open}
          />
        )
      }
      {...edit?.frame}
    >
      {(active.kind === "pages" && slug) ||
      (isNav && (navDraft.ready || navDraft.loading)) ? (
        main
      ) : (
        <Panel>{main}</Panel>
      )}
      {edit?.dialogs}
      {host.git && (
        <ReviewPanel
          git={host.git}
          pages={pages}
          drafts={async () => [
            // The open page's draft may be newer than `pages`, read before it autosaved.
            ...pages.filter((p) => p.hasDraft || (edit?.drafted && p.slug === slug)).map(({ slug, title }) => ({ slug, title })),
            // The menu's draft lives on the site doc, which is never a page.
            // Read now: Review saved what was left first, and a push moves both.
            ...((await host.getPage?.(SITE_SLUG).then((r) => r.hasDraft ?? false, () => navDraft.drafted)) ?? navDraft.drafted
              ? [{ slug: SITE_SLUG, title: "Navigation", detail: "Menu" }]
              : []),
            ...((await host.settings?.hasDraft?.(locale).catch(() => settingsDraft.drafted)) ?? settingsDraft.drafted
              ? [{ slug: SETTINGS_DRAFT, title: "Site settings", detail: "Settings and Style" }]
              : []),
          ]}
          onDiscardDraft={async (s) => {
            if (s !== SETTINGS_DRAFT) return host.actions.discardDraft(s, locale);
            if (!host.settings?.discardDraft) throw new Error("This studio can’t discard the settings draft.");
            await host.settings.discardDraft(locale);
          }}
          open={reviewing}
          onClose={() => setReviewing(false)}
          onChanged={(discarded) => {
            setGitRev((n) => n + 1);
            // A push published the chosen drafts, so pages' draft marks moved.
            onReload();
            // A discard rewrote files on disk: the preview and the menu draft
            // read them again too.
            navDraft.reload();
            if (discarded) reloadPreview();
          }}
        />
      )}
      {wizard && (
        <NewPageWizard
          host={host}
          pages={pages}
          folders={folders}
          template={wizard.template}
          onClose={() => setWizard(null)}
          onPage={createFromWizard}
          onFolder={
            host.pageFolders &&
            (async (f) => {
              await host.pageFolders!.create(f);
              setWizard(null);
              onReload();
            })
          }
        />
      )}
    </Frame>
  );
}

/** The rounded frame non-preview entries render in, matching the preview's. */
export function Panel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="typren-surface-1 flex min-h-0 min-w-0 flex-1 rounded-[var(--typren-radius-card)] border border-[var(--typren-stroke-card)] bg-[var(--typren-layer)]">
      <div className="flex min-w-0 flex-1 overflow-hidden rounded-[inherit]">
        {children}
      </div>
    </div>
  );
}
