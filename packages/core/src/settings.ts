import fs from "node:fs";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { makeActions } from "./actions";
import { commitOrRestore } from "./git";
import { createStore } from "./store";
import { resolveAuth } from "./auth-adapter";
import { resolveI18n } from "./i18n";
import type { CmsConfig, ContentAdapter, MediaAsset } from "./types";
import type { RoutingMode } from "./i18n";
import type { SaveResult } from "./actions";
import type { GitLogEntry } from "./git";

/** Content-shaped, locale-aware, hot-editable: a reserved-slug PageContent in
 *  a PRIVATE dir (never the Pages dir). */
export interface SiteSettingsRuntime {
  /** `logoDark` is the variant for dark surfaces (the admin shell in dark mode).
   *  Optional: a host with a single logo that reads on both, or no logo at all,
   *  sets only `logo` and consumers fall back to it. */
  brand: { name: string; logo?: MediaAsset; logoDark?: MediaAsset };
  seo: { titleTemplate?: string; description?: string; ogImage?: MediaAsset };
  theme?: { preset?: "shadcn" | "neutral" };
  /** The site's `--typren-*` style tokens (custom property to value); see `styleCss`. */
  style?: Record<string, string>;
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
/** Keys `SettingsStore.writeBootstrap` (and so `PUT /settings/bootstrap`)
 *  may patch. Anything else in the patch is rejected before it ever reaches
 *  the adapter's `writeBootstrap`, which has no key allowlist of its own. */
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
 * `typren apply-settings` (packages/cli/src/cli.ts), and the settings store's
 * bootstrap write (`SettingsStore.writeBootstrap`), so a config that passes one passes all
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
  /** What the editor shows: the draft when there is one, else the published
   *  doc, with the version to save against. Read tier, as a page's draft is. */
  open(locale?: string): Promise<{ settings: SiteSettingsRuntime; version: string | null; hasDraft: boolean }>;
  saveDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string): Promise<SaveResult>;
  publish(baseVersion?: string, locale?: string): Promise<SaveResult>;
  /** Drops the draft, so the published doc shows again. */
  discardDraft(locale?: string): Promise<void>;
  /** The settings doc's commits in a local git checkout, newest first; empty
   *  without git or a file-backed doc. */
  history(locale?: string, limit?: number): Promise<GitLogEntry[]>;
  /** Patches the bootstrap file, as admin: only `BOOTSTRAP_KEYS`, and only
   *  when the merged result passes `validateBootstrap`. A refused patch is
   *  data, its `error` written for the person changing it. */
  writeBootstrap(patch: Partial<SiteSettingsBootstrap>): Promise<{ ok: true } | { ok: false; error: string }>;
  bootstrap: SettingsAdapter;
}

/** The private content adapter beside the Pages one: settings and the saved
 *  slice library (see library.ts) live there as reserved-slug docs. */
export function privateContentAdapter(config: CmsConfig): ContentAdapter {
  // Existing fs sites keep today's location exactly (sibling of the Pages
  // content dir): only a markdown Pages adapter carries `root` (see
  // markdown-adapter.ts's `MarkdownAdapter` type), so that's the detection.
  // A non-fs Pages adapter (GitHub, Notion) has no root to site a sibling
  // dir next to, so it must bring its own settings-content adapter.
  return "root" in config.adapter
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

  const base = privateContentAdapter(config);
  // The published file's bytes before its latest write, so a failed commit can
  // put it back (or remove it when the publish created it).
  const before = new Map<string, Buffer | null>();
  const adapter: ContentAdapter = {
    ...base,
    async writeRaw(slug, raw, locale, opts) {
      const file = pageFile?.(slug, locale);
      if (file) before.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
      await base.writeRaw(slug, raw, locale, opts);
    },
  };
  // A file-backed doc in a local git checkout commits on publish, the way a
  // page Save does; makeActions refuses a detached HEAD before the publish.
  const pageFile = "pageFile" in adapter ? (adapter.pageFile as (slug: string, locale?: string) => string) : undefined;
  const git = pageFile && config.git;
  const onPublish =
    git &&
    (async (slug: string, locale: string) => {
      const where = locale === adapter.defaultLocale ? "" : ` (${locale})`;
      // The publish already wrote the doc; a failed commit puts its draft
      // back, so Publish stays pending and a retry after the fix commits it.
      const file = pageFile!(slug, locale);
      const prior = before.get(file);
      const restore = async () => {
        await adapter.writeDraftRaw(slug, await adapter.readRaw(slug, locale), locale);
        if (prior) fs.writeFileSync(file, prior);
        else if (prior === null) fs.rmSync(file, { force: true });
      };
      await commitOrRestore(git, [file], `content: update settings${where}`, restore, async () => {});
    });
  const actions = makeActions({ ...config, adapter, onPublish, onSaveDraft: undefined, withCommit: undefined });
  const store = createStore(adapter);
  const auth = resolveAuth(config);
  const guardAs = async (action: "admin" | "read", locale?: string) => {
    if (!(await auth.authorize({ action, locale, siteId: config.siteId, accountId: config.accountId }))) throw new Error("typren: unauthorized");
  };
  const guardAdmin = (locale?: string) => guardAs("admin", locale);
  const EMPTY: SiteSettingsRuntime = { brand: { name: "" }, seo: {} };
  const bootstrap =
    config.settingsAdapter ?? createFsSettingsAdapter({ file: path.join(process.cwd(), "typren.config.json") });
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
    async open(locale) {
      await guardAs("read", locale);
      const [draft, version] = await Promise.all([store.getDraft(SETTINGS_SLUG, locale), store.currentVersion(SETTINGS_SLUG, locale)]);
      const settings = draft ? (draft.meta as unknown as SiteSettingsRuntime) : await this.get(locale);
      return { settings, version, hasDraft: Boolean(draft) };
    },
    async discardDraft(locale) {
      await guardAdmin(locale);
      await actions.discardDraft(SETTINGS_SLUG, locale);
    },
    async history(locale, limit) {
      await guardAs("read", locale);
      if (!git) return [];
      return git.history(pageFile!(SETTINGS_SLUG, locale ?? adapter.defaultLocale), limit);
    },
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
    async writeBootstrap(patch) {
      await guardAdmin();
      const unknownKey = Object.keys(patch).find((k) => !BOOTSTRAP_KEYS.has(k));
      if (unknownKey) return { ok: false, error: `unknown bootstrap key "${unknownKey}"` };
      // Validate the MERGED result, not just the patch: a patch that only
      // touches `locales` must still leave defaultLocale/routing consistent,
      // and writeBootstrap merges the same way (see createFsSettingsAdapter).
      const error = validateBootstrap({ ...bootstrap.readBootstrap(), ...patch });
      if (error) return { ok: false, error };
      bootstrap.writeBootstrap(patch);
      return { ok: true };
    },
    bootstrap,
  };
}
