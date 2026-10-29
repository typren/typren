import {
  BOOTSTRAP_KEYS,
  createLocalSiteConfig,
  createSettingsStore,
  makeActions,
  type CmsConfig,
  type LocalSite,
  type PageContent,
  type PageInfo,
  type Section,
  type SiteSettings,
  type SliceSchema,
} from "@typren/core";
import { localAuth } from "@typren/core/auth/local";

/** What `typren studio` passes this app in the `TYPREN_STUDIO` env var: the
 *  site's facts (see `LocalSite`) plus the data parts of its cms.config,
 *  never the module itself.
 *  ponytail: the site's cms.config.ts imports React components through the
 *  site's own path aliases, so a separate Next app can't import it. The CLI
 *  reads slice defaults and field hints instead, and core rebuilds the rest
 *  from the site's scaffold conventions (markdown content dir, public/img
 *  media, typren.config.json). A site with a custom adapter, auth or media
 *  store needs a studio config entry point of its own. */
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

export function readManifest(raw: string | undefined = process.env.TYPREN_STUDIO): StudioManifest {
  if (!raw) throw new Error("typren studio: TYPREN_STUDIO is not set. Start the studio with `typren studio` from the site's root.");
  return JSON.parse(raw) as StudioManifest;
}

export function studioConfig(manifest: StudioManifest): CmsConfig {
  return {
    // The studio runs `next dev -H 127.0.0.1` (see `typren studio`), which is
    // exactly the bind localAuth requires.
    ...createLocalSiteConfig(manifest, { auth: localAuth() }),
    // The studio only needs slice names (passed as `host.sliceNames`); the
    // components render in the site.
    defaults: manifest.defaults,
    fieldSchema: manifest.fieldSchema,
    // ponytail: the studio appends "/<slug>" to this, so slugs map to site
    // paths one-to-one (StudioMount's `previewUrl` special-cases home).
    previewPath: previewBase(manifest),
  };
}

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

/** The studio's initial data, read through core's actions. Returns null
 *  when `read` is denied, the same gate the HTTP API applies to its GETs. */
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

const denied = (e: unknown) => e instanceof Error && /unauthorized/.test(e.message);

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
