import fs from "node:fs";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { makeActions } from "./actions";
import { createStore } from "./store";
import { resolveAuth } from "./auth-adapter";
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
  const guardAdmin = async () => {
    if (!(await auth.authorize({ action: "admin", siteId: config.siteId, accountId: config.accountId })))
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
      await guardAdmin();
      return actions.saveDraft(
        SETTINGS_SLUG,
        { meta: next as unknown as Record<string, unknown>, slices: [], body: "" },
        baseVersion,
        locale
      );
    },
    async publish(baseVersion, locale) {
      await guardAdmin();
      return actions.publish(SETTINGS_SLUG, baseVersion, locale);
    },
    bootstrap: config.settingsAdapter ?? createFsSettingsAdapter({ file: path.join(process.cwd(), "typren.config.json") }),
  };
}
