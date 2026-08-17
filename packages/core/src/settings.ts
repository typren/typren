import fs from "node:fs";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { makeActions } from "./actions";
import { createStore } from "./store";
import { resolveAuth } from "./auth-adapter";
import type { CmsConfig, MediaAsset } from "./types";
import type { RoutingMode } from "./i18n";
import type { SaveResult } from "./actions";

/** Content-shaped, locale-aware, hot-editable — a reserved-slug PageContent in
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

/** Default bootstrap adapter — one root JSON, atomic tmp+rename write so no
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
 *  adapter — ZERO new persistence code, same optimistic-lock + conflict UI.
 *  Reads/writes still pass through makeActions' own content-write guard, but
 *  settings docs reparameterize what the next boot trusts, so writes ALSO
 *  require the distinct "admin" AuthAction (addendum #4) — checked here,
 *  in front of makeActions, since actions.ts itself stays at zero diff. */
const SETTINGS_SLUG = "settings";

export interface SettingsStore {
  get(locale?: string): SiteSettingsRuntime;
  /** Version of the stored settings doc, for the same optimistic-lock flow pages
   *  use. Without this a client had nothing to seed `baseVersion` from, so its
   *  FIRST save passed `undefined` — which `store.saveDraft` treats as "no base
   *  version to check" and writes unconditionally, silently overwriting whatever
   *  another session had just saved. */
  currentVersion(locale?: string): string | null;
  saveDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string): Promise<SaveResult>;
  publish(baseVersion?: string, locale?: string): Promise<SaveResult>;
  bootstrap: SettingsAdapter;
}

export function createSettingsStore(config: CmsConfig): SettingsStore {
  const dir = path.join(path.dirname(config.adapter.root), ".typren");
  const adapter = createMarkdownAdapter({
    contentDir: dir,
    locales: config.adapter.locales,
    defaultLocale: config.adapter.defaultLocale,
  });
  const actions = makeActions({ ...config, adapter, onPublish: undefined, onSaveDraft: undefined });
  const store = createStore(adapter);
  const auth = resolveAuth(config);
  const guardAdmin = async () => {
    if (!(await auth.authorize({ action: "admin" }))) throw new Error("typren: unauthorized");
  };
  const EMPTY: SiteSettingsRuntime = { brand: { name: "" }, seo: {} };
  return {
    get: (locale) =>
      adapter.exists(SETTINGS_SLUG, locale)
        ? (store.getPublished(SETTINGS_SLUG, locale).meta as unknown as SiteSettingsRuntime)
        : EMPTY,
    currentVersion: (locale) =>
      adapter.exists(SETTINGS_SLUG, locale) ? store.currentVersion(SETTINGS_SLUG, locale) : null,
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
