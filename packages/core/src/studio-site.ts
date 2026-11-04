import { makeActions } from "./actions";
import { createLocalSiteConfig, type LocalSite } from "./local-site";
import { BOOTSTRAP_KEYS, createSettingsStore, type SiteSettings } from "./settings";
import type { AuthAdapter } from "./auth-adapter";
import type { Section } from "./sections";
import type { StyleMap } from "./style";
import type { CmsConfig, PageContent, PageInfo, SliceSchema } from "./types";

/** What `typren studio` hands its front end (the local studio app's
 *  `TYPREN_STUDIO` env var, or its own API server): the site's facts (see
 *  `LocalSite`) plus the data parts of its cms.config, never the module.
 *  ponytail: the site's cms.config.ts imports React components through the
 *  site's own path aliases, so the studio can't import it. The CLI reads
 *  slice defaults and field hints instead, and core rebuilds the rest from
 *  the site's scaffold conventions (markdown content dir, public/img media,
 *  typren.config.json). A site with a custom adapter, auth or media store
 *  needs a studio config entry point of its own. */
export type StudioManifest = LocalSite & {
  /** Origin of the site's dev server, e.g. "http://127.0.0.1:3000". */
  siteUrl: string;
  defaults: Record<string, Record<string, unknown>>;
  fieldSchema?: Record<string, SliceSchema>;
  /** The rest of the `studio` block, validated by the CLI; each key falls
   *  back to the scaffold's convention. */
  sections?: Section[];
  /** Route prefix page previews live at, e.g. "/draft". Default none. */
  previewPath?: string;
  /** Path of the one-slice route, or `false` for none. Default "/typren/section". */
  sectionRoute?: string | false;
  /** Page path prefixes under a nested layout, previewed on their real route
   *  rather than the page canvas. Default none. */
  nestedLayouts?: string[];
};

/** What a site-backed studio knows about the site beyond its content. */
export type StudioSiteProps = {
  sliceNames: string[];
  defaults: Record<string, Record<string, unknown>>;
  fieldSchema?: Record<string, SliceSchema>;
  /** Site origin plus the preview route prefix, no trailing slash. */
  previewPath: string;
  /** The site's one-slice route, no trailing slash; undefined for a site without one. */
  sectionRouteUrl?: string;
  /** Page paths framed on their real route (`studio.nestedLayouts`). */
  nestedLayouts?: string[];
  homeSlug: string;
  /** The site's rail; the studio's default when omitted. */
  sections?: Section[];
  /** The Settings panel may write bootstrap keys (typren.config.json exists). */
  writeBootstrap?: boolean;
  /** The site serves pages at "/<slug>/" (see `siteTrailingSlash`). */
  trailingSlash: boolean;
  /** The site is a git checkout, so Review pushes drafts as commits. */
  git: boolean;
  styleMap?: StyleMap;
};

/** The studio's initial data, read through core's actions. */
export type StudioData = {
  pages: PageInfo[];
  /** Page folders kept without pages (see `ContentAdapter.listFolders`). */
  folders: string[];
  slug: string | null;
  page?: PageContent;
  version: string | null;
  settings: SiteSettings;
  settingsVersion: string | null;
  /** The settings doc has a draft not published (pushed) yet. */
  settingsHasDraft: boolean;
};

/** Everything a studio needs to open: `GET /studio`'s body, and the local
 *  studio app's server-rendered props. */
export type StudioProps = StudioData & StudioSiteProps;

/** Where page previews are framed: the site origin plus the manifest's
 *  `previewPath` prefix, without a trailing slash. */
export function previewBase(manifest: StudioManifest): string {
  return manifest.siteUrl + (manifest.previewPath ?? "").replace(/\/$/, "");
}

/** The one-slice route's URL without a trailing slash, or undefined for a
 *  site with none. */
export function sectionRouteUrl(manifest: StudioManifest): string | undefined {
  return manifest.sectionRoute === false ? undefined : manifest.siteUrl + (manifest.sectionRoute ?? "/typren/section");
}

/** The studio's `CmsConfig` for the site: one config path for every studio
 *  front end, each bringing the auth that fits how it is reached. */
export function studioSiteConfig(manifest: StudioManifest, auth: AuthAdapter): CmsConfig {
  return {
    ...createLocalSiteConfig(manifest, { auth }),
    // The studio only needs slice names; the components render in the site.
    defaults: manifest.defaults,
    fieldSchema: manifest.fieldSchema,
    // ponytail: the studio appends "/<slug>" to this, so slugs map to site
    // paths one-to-one (the studio host's `previewUrl` special-cases home).
    previewPath: previewBase(manifest),
  };
}

const denied = (e: unknown) => e instanceof Error && /unauthorized/.test(e.message);

/** The studio's initial data. Returns null when `read` is denied, the same
 *  gate the HTTP API applies to its GETs. */
export async function loadStudio(config: CmsConfig, slug: string | null): Promise<StudioData | null> {
  const actions = makeActions(config);
  const settingsStore = createSettingsStore(config);
  try {
    // The adapter rejects unsafe slugs by throwing; for a URL that is just
    // "no such page" (the browser's /favicon.ico lands here too).
    const opened = slug ? await actions.getPage(slug).catch((e: unknown) => (denied(e) ? Promise.reject(e) : null)) : null;
    const [pages, folders, settingsRead] = await Promise.all([actions.listPages(), actions.listPageFolders(), settingsStore.open()]);
    const { settings: runtime, version: settingsVersion, hasDraft: settingsHasDraft } = settingsRead;
    // The editable keys only, as GET /settings returns: the CLI's `studio` block is not page data.
    const bootstrap = Object.fromEntries(Object.entries(settingsStore.bootstrap.readBootstrap()).filter(([k]) => BOOTSTRAP_KEYS.has(k)));
    const base = { pages, folders, settings: { ...runtime, bootstrap: bootstrap as SiteSettings["bootstrap"] }, settingsVersion, settingsHasDraft };
    return opened ? { ...base, slug, page: opened.page, version: opened.version } : { ...base, slug: null, version: null };
  } catch (e) {
    if (denied(e)) return null;
    throw e;
  }
}

let slashCache: boolean | undefined;

/** Whether the site serves pages at "/<slug>/", read off how it redirects a
 *  page URL. The preview frame is sandboxed and doesn't reliably follow that
 *  redirect, so the studio links the final URL directly. Cached once the
 *  site answers; while its dev server is still starting, assumes no slash. */
export async function siteTrailingSlash(siteUrl: string, slug: string | undefined): Promise<boolean> {
  if (slashCache !== undefined || !slug) return slashCache ?? false;
  try {
    const res = await fetch(`${siteUrl}/${slug}`, { redirect: "manual" });
    const to = res.headers.get("location");
    slashCache = res.status >= 300 && res.status < 400 && !!to && new URL(to, siteUrl).pathname.endsWith("/");
    return slashCache;
  } catch {
    return false;
  }
}

/** `loadStudio` plus the site facts from the manifest: what a studio opens
 *  with, `slug` (default the home page) open. Null when `read` is denied. */
export async function loadStudioProps(config: CmsConfig, manifest: StudioManifest, slug?: string | null): Promise<StudioProps | null> {
  const homeSlug = manifest.homeSlug ?? "home";
  const data = await loadStudio(config, slug ?? homeSlug);
  if (!data) return null;
  const base = previewBase(manifest);
  return {
    ...data,
    sliceNames: Object.keys(manifest.defaults),
    defaults: manifest.defaults,
    fieldSchema: manifest.fieldSchema,
    previewPath: base,
    sectionRouteUrl: sectionRouteUrl(manifest),
    nestedLayouts: manifest.nestedLayouts,
    homeSlug,
    sections: manifest.sections,
    writeBootstrap: manifest.writeBootstrap,
    trailingSlash: await siteTrailingSlash(base, data.pages.find((p) => p.slug !== homeSlug)?.slug),
    git: Boolean(config.git),
    styleMap: manifest.styleMap,
  };
}
