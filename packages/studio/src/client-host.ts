import type { Section, StudioSiteProps } from "@typren/core";
import type { TyprenClient } from "@typren/core/api/client";
import type { TyprenStudioHost } from "./types";

/** The Website group from docs/editor-v3.md. SEO has no entry of its own:
 *  Settings already holds the title template, description and share image,
 *  and a separate SEO & AIO section kind has not landed. */
export const STUDIO_SECTIONS: Section[] = [
  { kind: "pages", label: "Pages", group: "website" },
  { kind: "custom", id: "navigation", label: "Navigation", group: "website", host: true },
  { kind: "custom", id: "style", label: "Style", group: "website", host: true },
  { kind: "media", id: "assets", label: "Assets", group: "website" },
  { kind: "library", id: "templates", label: "Templates", group: "website" },
  { kind: "settings", label: "Settings", group: "other" },
];

/**
 * Binds `TyprenStudioHost` to the content API through its HTTP client: the
 * one wiring both the local studio and the connected (cloud-served) studio
 * use, so they cannot drift. `site` is core's `StudioSiteProps` (what
 * `loadStudioProps` and `GET /studio` return); `uploadPath` is the API's
 * media route.
 */
export function clientHost(actions: TyprenClient, site: StudioSiteProps, uploadPath: string): TyprenStudioHost {
  const { previewPath, homeSlug, trailingSlash, git, sectionRouteUrl, writeBootstrap } = site;
  return {
    actions,
    sliceNames: site.sliceNames,
    defaults: site.defaults,
    fieldSchema: site.fieldSchema,
    previewPath,
    sections: site.sections ?? STUDIO_SECTIONS,
    homeSlug,
    library: actions.library,
    // The site's one-slice route (see docs/site/studio.md); Templates shows sketches without it.
    sectionPreviewUrl: sectionRouteUrl && `${sectionRouteUrl}${trailingSlash ? "/" : ""}`,
    nestedLayouts: site.nestedLayouts,
    styleMap: site.styleMap,
    git: git
      ? {
          outgoing: () => actions.gitOutgoing(),
          pending: () => actions.gitPending(),
          push: (paths, slugs, settings) => actions.gitPush(paths, slugs, settings),
          history: (s, l) => actions.gitHistory(s, l),
          discard: (paths) => actions.gitDiscard(paths),
        }
      : undefined,
    settings: {
      saveDraft: (next, base, locale) => actions.saveSettingsDraft(next, base, locale),
      publish: (base, locale) => actions.publishSettings(base, locale),
      discardDraft: (locale) => actions.discardSettingsDraft(locale),
      hasDraft: (locale) => actions.getSettings(locale).then((s) => Boolean((s as { hasDraft?: boolean }).hasDraft)),
      history: git ? (locale) => actions.settingsHistory(locale) : undefined,
      writeBootstrap: writeBootstrap ? (patch) => actions.writeBootstrap(patch) : undefined,
      hideAdminRoute: true,
    },
    // The site serves its home page at "/", not "/home".
    previewUrl: (s) => (s === homeSlug ? `${previewPath}/` : `${previewPath}/${s}${trailingSlash ? "/" : ""}`),
    readPage: (s) => actions.getPage(s).then((r) => r.page),
    getPage: (s) => actions.getPage(s),
    pageFolders: { create: (f) => actions.createPageFolder(f), delete: (f) => actions.deletePageFolder(f) },
    renamePage: (s, to) => actions.renamePage(s, to),
    media: {
      list: () => actions.listMedia(),
      delete: (id: string, opts?: { force?: boolean }) => actions.deleteMedia(id, opts),
      uploadPath,
      // Through the client, so a token-authenticated host's credentials go too.
      upload: (file, folder) => actions.uploadMedia(file, folder),
      usage: () => actions.mediaUsage(),
      folders: {
        list: () => actions.listMediaFolders(),
        create: (f) => actions.createMediaFolder(f),
        delete: (f) => actions.deleteMediaFolder(f),
        move: (id, f, name) => actions.moveMedia(id, f, name),
        rename: (f, to) => actions.renameMediaFolder(f, to),
      },
    },
  };
}
