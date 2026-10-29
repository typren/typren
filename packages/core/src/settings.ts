import fs from "node:fs";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { makeActions } from "./actions";
import { createStore } from "./store";
import { resolveAuth } from "./auth-adapter";
import { resolveI18n } from "./i18n";
import type { CmsConfig, MediaAsset } from "./types";
import type { RoutingMode } from "./i18n";
import type { SaveResult } from "./actions";

/** Content-shaped, locale-aware, hot-editable: a reserved-slug PageContent in
 *  a PRIVATE dir (never the Pages dir). */
export interface SiteSettingsRuntime {
  /** `logoDark` is the variant for dark surfaces (the admin shell in dark mode).
   *  Optional: a host with a single logo that reads on both, or no logo at all,
   *  sets only `logo` and consumers fall back to it. */
  brand: { name: string; logo?: MediaAsset; logoDark?: MediaAsset };
  seo: { titleTemplate?: string; description?: string; ogImage?: MediaAsset };
  theme?: { preset?: "shadcn" | "neutral" };
}

/** NOT locale-scoped, NOT adapter-managed. Small root JSON, read at server
 *  start (cms.config.ts), by the CLI, and optionally by proxy.ts (Wave 5). */
export interface SiteSettingsBootstrap {
  adminRoute: string; // default "editor"
  locales: string[];
  defaultLocale: string;
  routing: RoutingMode;
  onboarded: boolean;
}

export type SiteSettings = SiteSettingsRuntime & { bootstrap: SiteSettingsBootstrap };

export interface SettingsAdapter {
  readBootstrap(): SiteSettingsBootstrap;
  writeBootstrap(patch: Partial<SiteSettingsBootstrap>): void;
}

// Same SAFE_SLUG-shaped route rule markdown-adapter.ts uses for slugs, plus a
// reserved-word check. Duplicated (not imported) from markdown-adapter.ts: an
// admin route and a content slug are different trust boundaries that happen
// to share a shape today.
const SAFE_ADMIN_ROUTE = /^[a-z0-9][a-z0-9-]*$/i;
const RESERVED_ADMIN_ROUTES = new Set(["api", "_next"]);
// BCP-47-ish: a primary subtag of 2-3 letters, then any number of 2-8
// alphanumeric extension subtags. Deliberately loose (real BCP-47 allows
// singleton extensions, script/region casing rules, etc.); the only thing
// this gate needs to guarantee is that a locale string can never be anything
// other than a plain, bounded path segment (see createMarkdownAdapter, which
// uses the same shape for the same reason).
const BCP47_LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const ROUTING_MODES: RoutingMode[] = ["prefix-except-default", "prefix-all"];
/** Keys `PUT /settings/bootstrap` may patch (see api/routes.ts settingsRoutes).
 *  Anything else in the patch is rejected before it ever reaches
 *  `writeBootstrap`, since that adapter has no key allowlist of its own. */
export const BOOTSTRAP_KEYS: ReadonlySet<string> = new Set([
  "adminRoute",
  "locales",
  "defaultLocale",
  "routing",
  "onboarded",
]);

/**
 * Validates a FULL bootstrap (not a partial patch): the one check shared by
 * the Settings "Advanced" panel, the onboarding wizard's admin-route step,
 * `typren apply-settings` (packages/cli/src/cli.ts), and the settings API's
 * bootstrap write (api/routes.ts), so a config that passes one passes all
 * four. Returns an error string, or null when valid. Reuses `resolveI18n`'s
 * own defaultLocale-in-locales check rather than re-deriving it.
 */
export function validateBootstrap(bs: SiteSettingsBootstrap): string | null {
  if (!SAFE_ADMIN_ROUTE.test(bs.adminRoute))
    return `adminRoute "${bs.adminRoute}" must start with a letter/digit and contain only letters, digits, or hyphens`;
  if (RESERVED_ADMIN_ROUTES.has(bs.adminRoute.toLowerCase()))
    return `adminRoute "${bs.adminRoute}" is a reserved path and can't be used as the admin route`;
  if (!Array.isArray(bs.locales) || bs.locales.length === 0 || !bs.locales.every((l) => BCP47_LOCALE.test(l)))
    return `locales must be a non-empty array of BCP-47-ish locale codes, got ${JSON.stringify(bs.locales)}`;
  if (!ROUTING_MODES.includes(bs.routing))
    return `routing "${bs.routing}" must be one of ${ROUTING_MODES.join(", ")}`;
  if (typeof bs.onboarded !== "boolean") return `onboarded must be a boolean, got ${JSON.stringify(bs.onboarded)}`;
  try {
    resolveI18n({ locales: bs.locales, defaultLocale: bs.defaultLocale, routing: bs.routing });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

/** Default bootstrap adapter: one root JSON, atomic tmp+rename write so no
 *  reader ever observes a half-written config that gates server boot. */
export function createFsSettingsAdapter(opts: { file: string }): SettingsAdapter {
  const DEFAULTS: SiteSettingsBootstrap = {
    adminRoute: "editor",
    locales: ["en"],
    defaultLocale: "en",
    routing: "prefix-except-default",
    onboarded: false,
  };
  return {
    readBootstrap() {
      if (!fs.existsSync(opts.file)) return DEFAULTS;
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(opts.file, "utf8")) };
    },
    writeBootstrap(patch) {
      const next = { ...this.readBootstrap(), ...patch };
      const tmp = `${opts.file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, opts.file);
    },
  };
}

/** Runtime half reuses createStore/makeActions verbatim on a private-dir
 *  adapter. ZERO new persistence code, same optimistic-lock + conflict UI.
 *  Reads/writes still pass through makeActions' own content-write guard, but
 *  settings docs reparameterize what the next boot trusts, so writes ALSO
 *  require the distinct "admin" AuthAction (addendum #4), checked here,
 *  in front of makeActions, since actions.ts itself stays at zero diff. */
const SETTINGS_SLUG = "settings";

export interface SettingsStore {
  get(locale?: string): Promise<SiteSettingsRuntime>;
  /** Version of the stored settings doc, for the same optimistic-lock flow pages
   *  use. Without this a client had nothing to seed `baseVersion` from, so its
   *  FIRST save passed `undefined`, which `store.saveDraft` treats as "no base
   *  version to check" and writes unconditionally, silently overwriting whatever
   *  another session had just saved. */
  currentVersion(locale?: string): Promise<string | null>;
  saveDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string): Promise<SaveResult>;
  publish(baseVersion?: string, locale?: string): Promise<SaveResult>;
  bootstrap: SettingsAdapter;
}

export function createSettingsStore(config: CmsConfig): SettingsStore {
  // A hosted/multi-tenant config (siteId set, per docs/hosted-platform.md)
  // with no explicit settingsAdapter would otherwise fall through to the
  // single-process default below (one `typren.config.json` at
  // `process.cwd()`), which every tenant's CmsConfigFactory call resolves to
  // the SAME path -- every site's bootstrap (adminRoute, locales, onboarded)
  // would read/write the same file, structurally breaking tenant isolation
  // rather than merely risking it. Caught here, once, same as the
  // settingsContentAdapter checks below.
  if (config.siteId !== undefined && config.settingsAdapter === undefined) {
    throw new Error(
      "typren: config.siteId is set (hosted/multi-tenant mode) but no config.settingsAdapter was given -- the default bootstrap adapter is a single shared file and would collide across tenants"
    );
  }
  // Settings is a reserved slug ("settings") written through its own
  // adapter: if that adapter is (or points at the same storage as) the
  // Pages adapter, a page actually named "settings" and the settings doc
  // would silently collide -- whichever one last wrote wins, with no error
  // either direction ever surfaces. Caught here, once, at construction,
  // rather than as a mystery bug report the first time a site names a page
  // "settings". See docs/migrations for the distinct-directory requirement.
  if (config.settingsContentAdapter !== undefined) {
    if (config.settingsContentAdapter === config.adapter) {
      throw new Error(
        'typren: config.settingsContentAdapter must not be the same adapter instance as config.adapter -- the "settings" slug would collide with a Pages slug of the same name. Use a distinct adapter (even a second instance of the same backend, pointed at a different location).'
      );
    }
    if ("root" in config.adapter && "root" in config.settingsContentAdapter) {
      const pagesRoot = path.resolve((config.adapter as { root: string }).root);
      const settingsRoot = path.resolve((config.settingsContentAdapter as { root: string }).root);
      if (pagesRoot === settingsRoot || pagesRoot.startsWith(`${settingsRoot}${path.sep}`) || settingsRoot.startsWith(`${pagesRoot}${path.sep}`)) {
        throw new Error(
          `typren: config.settingsContentAdapter's root ("${settingsRoot}") is the same as, or nested inside/around, config.adapter's root ("${pagesRoot}"). Settings must live in a distinct, non-overlapping directory so a page named "settings" can never collide with the settings doc.`
        );
      }
    }
  }

  // Existing fs sites keep today's location exactly (sibling of the Pages
  // content dir): only a markdown Pages adapter carries `root` (see
  // markdown-adapter.ts's `MarkdownAdapter` type), so that's the detection.
  // A non-fs Pages adapter (GitHub, Notion) has no root to site a sibling
  // dir next to, so it must bring its own settings-content adapter.
  const adapter =
    "root" in config.adapter
      ? createMarkdownAdapter({
          contentDir: path.join(path.dirname((config.adapter as { root: string }).root), ".typren"),
          locales: config.adapter.locales,
          defaultLocale: config.adapter.defaultLocale,
        })
      : (config.settingsContentAdapter ??
        (() => {
          throw new Error(
            "typren: config.adapter has no filesystem root (e.g. a GitHub or Notion adapter), so settings need an explicit config.settingsContentAdapter"
          );
        })());
  const actions = makeActions({ ...config, adapter, onPublish: undefined, onSaveDraft: undefined });
  const store = createStore(adapter);
  const auth = resolveAuth(config);
  const guardAdmin = async (locale?: string) => {
    if (!(await auth.authorize({ action: "admin", locale, siteId: config.siteId, accountId: config.accountId })))
      throw new Error("typren: unauthorized");
  };
  const EMPTY: SiteSettingsRuntime = { brand: { name: "" }, seo: {} };
  return {
    // Existence is checked against the DEFAULT locale: getPublished always
    // reads the default-locale doc as its base, and a locale with no
    // translation of its own must fall back to it (the same rule pages
    // follow), not to EMPTY.
    async get(locale) {
      if (!(await adapter.exists(SETTINGS_SLUG, adapter.defaultLocale))) return EMPTY;
      const published = await store.getPublished(SETTINGS_SLUG, locale);
      return published.meta as unknown as SiteSettingsRuntime;
    },
    // No exists() guard: store.currentVersion already returns null for a
    // missing doc, and gating on the published file dropped the version of a
    // draft-only doc, reopening the silent-first-save-overwrite hole this
    // method exists to close.
    currentVersion: (locale) => store.currentVersion(SETTINGS_SLUG, locale),
    async saveDraft(next, baseVersion, locale) {
      await guardAdmin(locale);
      return actions.saveDraft(
        SETTINGS_SLUG,
        { meta: next as unknown as Record<string, unknown>, slices: [], body: "" },
        baseVersion,
        locale
      );
    },
    async publish(baseVersion, locale) {
      await guardAdmin(locale);
      return actions.publish(SETTINGS_SLUG, baseVersion, locale);
    },
    bootstrap: config.settingsAdapter ?? createFsSettingsAdapter({ file: path.join(process.cwd(), "typren.config.json") }),
  };
}
