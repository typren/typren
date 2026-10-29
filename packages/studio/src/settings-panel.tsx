"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Settings, TriangleAlert } from "lucide-react";
import type {
  MediaAsset,
  SiteSettings,
  SiteSettingsBootstrap,
  SiteSettingsRuntime,
  Slice,
  SliceSchema,
} from "@typren/core";
import { STYLE_TOKENS, sanitizeStyle } from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import { ReviewButton, useReviewGate } from "./review-panel";
import { SaveStatus, useAutosave } from "./save-status";
import { tokenError } from "./style-parts";
import type { TyprenStudioHost, TyprenStudioSettingsActions } from "./types";
import { FieldForm } from "./field-form";
import { useT } from "./intl";
import { useAnnounce } from "./announce";
import { Button } from "./primitives/button";
import { EmptyState } from "./primitives/empty";
import { useConfirm } from "./primitives/confirm";
import { ScrollArea } from "./primitives/scroll-area";

export const RUNTIME_SCHEMA: SliceSchema = {
  "brand.name": { type: "text", label: "Site name" },
  "brand.logo": { type: "image", label: "Logo" },
  "brand.logoDark": { type: "image", label: "Logo (dark surfaces)" },
  "seo.titleTemplate": { type: "text", label: "SEO title template" },
  "seo.description": { type: "textarea", label: "SEO description" },
  "seo.ogImage": { type: "image", label: "Social share image" },
};

const ADVANCED_SCHEMA: SliceSchema = {
  adminRoute: { type: "text", label: "Admin route" },
  locales: { type: "yaml", label: "Locales" },
  defaultLocale: { type: "text", label: "Default locale" },
  routing: {
    type: "select",
    options: ["prefix-except-default", "prefix-all"],
    label: "Routing mode",
  },
};

const { adminRoute: _route, ...ADVANCED_SCHEMA_NO_ROUTE } = ADVANCED_SCHEMA;
void _route;

const RESERVED_ROUTES = new Set(["api", "_next"]);
const SAFE_ROUTE = /^[a-z0-9][a-z0-9-]*$/i;

// ponytail: the stock image field only round-trips a bare URL string (same
// convention as every other image-typed slice prop, see field-form.tsx's
// `isSrcAlt` comment). Full MediaAsset metadata (size/mime/createdAt) isn't
// available from the picker's onChange, so it's stashed nowhere; only `.url`
// survives a round trip. Upgrade path: a settings-specific image field wired
// to MediaAdapter.upload directly, if size/mime ever need to be read back.
function assetUrl(a: MediaAsset | string | undefined): string {
  if (!a) return "";
  return typeof a === "string" ? a : a.url;
}
function toMediaAsset(url: string): MediaAsset {
  return { id: url, url, name: url, size: 0, mime: "", createdAt: "" };
}

function flattenRuntime(rt: SiteSettingsRuntime): Slice {
  return {
    slice: "Settings",
    "brand.name": rt.brand?.name ?? "",
    "brand.logo": assetUrl(rt.brand?.logo),
    "brand.logoDark": assetUrl(rt.brand?.logoDark),
    "seo.titleTemplate": rt.seo?.titleTemplate ?? "",
    "seo.description": rt.seo?.description ?? "",
    "seo.ogImage": assetUrl(rt.seo?.ogImage),
  };
}

function unflattenRuntime(flat: Record<string, unknown>): SiteSettingsRuntime {
  const name = String(flat["brand.name"] ?? "");
  const logoUrl = String(flat["brand.logo"] ?? "");
  const logoDarkUrl = String(flat["brand.logoDark"] ?? "");
  const titleTemplate = String(flat["seo.titleTemplate"] ?? "");
  const description = String(flat["seo.description"] ?? "");
  const ogImageUrl = String(flat["seo.ogImage"] ?? "");
  return {
    brand: {
      name,
      ...(logoUrl ? { logo: toMediaAsset(logoUrl) } : {}),
      ...(logoDarkUrl ? { logoDark: toMediaAsset(logoDarkUrl) } : {}),
    },
    seo: {
      ...(titleTemplate ? { titleTemplate } : {}),
      ...(description ? { description } : {}),
      ...(ogImageUrl ? { ogImage: toMediaAsset(ogImageUrl) } : {}),
    },
  };
}

function toBootstrapSlice(bs: SiteSettingsBootstrap): Slice {
  return {
    slice: "Advanced",
    adminRoute: bs.adminRoute,
    locales: bs.locales,
    defaultLocale: bs.defaultLocale,
    routing: bs.routing,
  };
}

function fromBootstrapSlice(
  flat: Record<string, unknown>,
): Partial<SiteSettingsBootstrap> {
  const locales = Array.isArray(flat.locales)
    ? (flat.locales as unknown[]).map(String)
    : undefined;
  return {
    adminRoute: String(flat.adminRoute ?? "studio"),
    ...(locales ? { locales } : {}),
    defaultLocale: String(flat.defaultLocale ?? "en"),
    routing:
      flat.routing === "prefix-all" ? "prefix-all" : "prefix-except-default",
  };
}

/** SAFE_ROUTE-shaped regex + reserved-word check, same rule a future
 *  onboarding wizard's admin-route step would use (see core's `CmsConfig.onboarding`). */
function validateAdminRoute(route: string): string | null {
  if (!SAFE_ROUTE.test(route))
    return "Admin route must start with a letter/digit and contain only letters, digits, or hyphens.";
  if (RESERVED_ROUTES.has(route.toLowerCase()))
    return `"${route}" is a reserved path and can't be used as the admin route.`;
  return null;
}

const EMPTY_RT: SiteSettingsRuntime = { brand: { name: "" }, seo: {} };
const EMPTY_BS: SiteSettingsBootstrap = {
  adminRoute: "studio",
  locales: ["en"],
  defaultLocale: "en",
  routing: "prefix-except-default",
  onboarded: false,
};

/**
 * The settings doc's draft and its lifecycle, kept by the shell so the
 * controls sit in the top bar like a page's. Settings and Style (see
 * `useStyleDraft`) edit this one doc, so they share this draft. Edits
 * autosave to the draft; the bar shows the save status, then Review with
 * `host.git` (the local studio, where a push commits the doc), else Discard
 * and Publish. The draft starts over whenever the host reloads settings.
 */
export function useSettingsDraft({
  host,
  snapshot,
  version: initialVersion = null,
  drafted: initialDrafted = false,
  locale,
  gitRev = 0,
  otherDrafts = false,
  onReload,
  onReview,
}: Readonly<{
  host: Pick<TyprenStudioHost, "settings" | "git">;
  snapshot?: SiteSettings;
  version?: string | null;
  /** The snapshot is the settings doc's draft, not pushed (published) yet. */
  drafted?: boolean;
  locale?: string;
  /** Moves after Review pushed or discarded, to refetch what waits. */
  gitRev?: number;
  /** Another screen has a saved draft, so Review has something to send. */
  otherDrafts?: boolean;
  onReload: () => void;
  onReview?: () => void;
}>) {
  const t = useT();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { settings, git } = host;
  const [rt, setRt] = useState<SiteSettingsRuntime>(snapshot ?? EMPTY_RT);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useAnnounce(status);
  // Style edits this doc too (see useStyleDraft); a token that doesn't parse
  // holds the autosave until it does.
  const invalid = STYLE_TOKENS.some((tok) => tokenError(tok, rt.style?.[tok.name] ?? ""));
  const auto = useAutosave({
    enabled: Boolean(settings) && !invalid,
    version: initialVersion,
    drafted: initialDrafted,
    write: (base) => settings!.saveDraft(runtimeOf(rt), base, locale),
  });
  const { dirty, conflict } = auto;
  useEffect(() => {
    // A new version is the host's reload; the snapshot arrives with it.
    if (snapshot) setRt(snapshot);
    auto.reset(initialVersion, initialDrafted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVersion]);
  const gate = useReviewGate(git, Boolean(settings), gitRev, auto.status.drafted || otherDrafts);

  const edit = (next: (prev: SiteSettingsRuntime) => SiteSettingsRuntime) => {
    setRt(next);
    auto.edit();
    setStatus("");
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      await fn();
    } catch (e) {
      setStatus(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Hosts without git: the draft goes live on Publish.
  const onPublish = () =>
    run(t("shell.publish"), async () => {
      if (!(await auto.flush())) return;
      const res = await settings!.publish(auto.base(), locale);
      if (!res.ok) {
        auto.setConflict(true);
        setStatus("");
        return;
      }
      auto.saved(res.version, false);
      setStatus("");
      onReload();
    });
  const onDiscard = async () => {
    const ok = await confirm({
      title: "Discard changes?",
      description: "Discard your settings and style changes? They go back to the published version.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (!ok) return;
    void run("Discard", async () => {
      await auto.flush();
      await settings!.discardDraft!(locale);
      setStatus("");
      onReload();
    });
  };
  const overwrite = async () => {
    setBusy(true);
    setStatus(t("shell.overwriting"));
    try {
      const res = await settings!.saveDraft(runtimeOf(rt), undefined, locale);
      if (res.ok) {
        auto.saved(res.version);
        setStatus("");
      }
    } finally {
      setBusy(false);
    }
  };

  const onFieldChange = (next: Slice) => {
    const { slice: _drop, ...flat } = next;
    void _drop;
    // The form has no fields for `style` (the Style screen owns it), so carry it over.
    // Style owns theming now; whatever theme and style are stored pass through.
    edit((prev) => ({
      ...unflattenRuntime(flat),
      ...(prev.theme ? { theme: prev.theme } : {}),
      ...(prev.style ? { style: prev.style } : {}),
    }));
  };

  const actions: ReactNode = settings && (
    <>
      {git ? (
        onReview && (
          <ReviewButton
            reason={gate.reason}
            disabled={busy}
            onClick={async () => {
              await auto.flush();
              onReview();
            }}
          />
        )
      ) : (
        <>
          {auto.status.drafted && settings.discardDraft && (
            <Button variant="destructive" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          )}
          <Button disabled={busy || conflict || invalid} onClick={onPublish}>
            {t("shell.publish")}
          </Button>
        </>
      )}
      {/* The status sits at the bar's edge, after what can be done. */}
      <SaveStatus {...auto.status} history={settings.history && (() => settings.history!(locale))} />
    </>
  );

  const banner: ReactNode = conflict ? (
    <div role="alert" className="flex flex-wrap items-center gap-3 bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]">
      <TriangleAlert className="size-4 shrink-0 text-[var(--typren-destructive)]" aria-hidden />
      <span className="min-w-0 flex-1">{t("shell.conflict")}</span>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onReload}>
          {t("shell.reload")}
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={overwrite}>
          {t("shell.overwrite")}
        </Button>
      </div>
    </div>
  ) : (
    (auto.error || gate.noBranch) && (
      <div role="alert" className="flex items-start gap-3 bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--typren-destructive)]" aria-hidden />
        <span className="grid min-w-0">
          <span className="font-medium">{auto.error ? "Couldn’t save the settings" : "Saving is off"}</span>
          <span>{auto.error || gate.noBranch}</span>
        </span>
      </div>
    )
  );

  return {
    ready: Boolean(settings),
    rt,
    dirty,
    /** A saved draft or edits about to save. */
    drafted: auto.status.drafted,
    status,
    edit,
    flush: auto.flush,
    onFieldChange,
    actions,
    banner,
    dialog: confirmDialog,
  };
}

/** The runtime half to write: never the bootstrap the snapshot carries, and
 *  only style values that pass `sanitizeStyle`. */
function runtimeOf(rt: SiteSettingsRuntime): SiteSettingsRuntime {
  const { bootstrap: _bootstrap, ...rest } = rt as SiteSettings;
  void _bootstrap;
  return rest.style ? { ...rest, style: sanitizeStyle(rest.style) } : rest;
}

export type SettingsDraft = ReturnType<typeof useSettingsDraft>;

/**
 * The Settings section's body: maps the typed `SiteSettingsRuntime` fields
 * onto a flat `SliceSchema` and renders them through `FieldForm` verbatim (no
 * new form technology), with the same optimistic-lock conflict banner as
 * `PageEditor`. A separate collapsible "Advanced" panel edits the bootstrap
 * tier (adminRoute/locales/defaultLocale/routing) via `settings.writeBootstrap`;
 * see `TyprenStudioSettingsActions`'s doc comment for the auth boundary this
 * write crosses. Ported from meditor's `<meditor-settings>`.
 */
export function SettingsPanel({
  settings,
  git,
  snapshot,
  version,
  media,
  locale,
  onReload,
  draft: draftProp,
}: Readonly<{
  settings?: TyprenStudioSettingsActions;
  git?: TyprenStudioHost["git"];
  /** Host-fetched `{...SiteSettingsRuntime, bootstrap}` snapshot, a sync
   *  server read (`SettingsStore.get()`/`bootstrap.readBootstrap()`), so the
   *  host pre-fetches it, same pattern `page`/`initialVersion` use for Pages. */
  snapshot?: SiteSettings;
  version?: string | null;
  media?: FieldFormMedia;
  locale?: string;
  onReload: () => void;
  /** The shell's draft, whose controls then sit in the top bar. Without it
   *  the panel keeps its own and shows the controls in its header. */
  draft?: SettingsDraft;
}>) {
  const t = useT();
  const hideAdminRoute = !!settings?.hideAdminRoute;
  const own = useSettingsDraft({
    host: { settings, git },
    snapshot,
    version,
    locale,
    onReload,
  });
  const draft = draftProp ?? own;
  const { rt } = draft;
  const [bs, setBs] = useState<SiteSettingsBootstrap>(
    snapshot?.bootstrap ?? EMPTY_BS,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bsDirty, setBsDirty] = useState(false);
  const [bsBusy, setBsBusy] = useState(false);
  const [bsStatus, setBsStatus] = useState("");
  const [initialAdminRoute] = useState(bs.adminRoute);

  if (!settings) {
    return (
      <EmptyState icon={<Settings />} title="Settings aren’t configured for this site." />
    );
  }

  const onBsFieldChange = (next: Slice) => {
    const { slice: _drop, ...flat } = next;
    void _drop;
    setBs((prev) => ({ ...prev, ...fromBootstrapSlice(flat) }));
    setBsDirty(true);
    setBsStatus("");
  };

  const saveAdvanced = async () => {
    const err = hideAdminRoute ? null : validateAdminRoute(bs.adminRoute);
    if (err) {
      setBsStatus(err);
      return;
    }
    if (!bs.locales.includes(bs.defaultLocale)) {
      setBsStatus("Default locale must be one of the locales above.");
      return;
    }
    setBsBusy(true);
    setBsStatus("Saving…");
    try {
      const { adminRoute, locales, defaultLocale, routing } = bs;
      await settings?.writeBootstrap?.({
        ...(hideAdminRoute ? {} : { adminRoute }),
        locales,
        defaultLocale,
        routing,
      });
      setBsDirty(false);
      setBsStatus("Saved");
    } catch (e) {
      setBsStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBsBusy(false);
    }
  };

  const runtimeSlice = flattenRuntime(rt);
  const advancedSlice = toBootstrapSlice(bs);
  const advancedSchema = hideAdminRoute
    ? ADVANCED_SCHEMA_NO_ROUTE
    : ADVANCED_SCHEMA;
  const adminRouteChanged =
    !hideAdminRoute && bs.adminRoute !== initialAdminRoute;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--typren-border)] px-4 py-2">
        <span className="text-sm font-semibold">{t("settings.title")}</span>
        {!draftProp && (
          <div className="ml-auto flex items-center gap-2">{draft.actions}</div>
        )}
      </header>

      {!draftProp && draft.banner}
      {draft.dialog}

      {adminRouteChanged && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-[var(--typren-border)] bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]"
        >
          <TriangleAlert
            className="size-4 shrink-0 text-[var(--typren-muted-fg)]"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            {t("settings.adminRouteChanged")}
          </span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl p-6">
          <p className="mb-4 text-sm text-[var(--typren-muted-fg)]">
            {t("settings.blurb")}
          </p>
          <FieldForm
            slice={runtimeSlice}
            schema={RUNTIME_SCHEMA}
            onChange={draft.onFieldChange}
            media={media}
          />

          {settings?.writeBootstrap && (
            <>
              <hr className="my-6 border-[var(--typren-border)]" />

              <Button
                variant="ghost"
                size="sm"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                {advancedOpen ? <ChevronUp /> : <ChevronDown />}{" "}
                {t("settings.advanced")}
              </Button>

              {advancedOpen && (
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-sm text-[var(--typren-muted-fg)]">
                    {t("settings.advancedBlurb")}
                  </p>
                  <FieldForm
                    slice={advancedSlice}
                    schema={advancedSchema}
                    onChange={onBsFieldChange}
                  />
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--typren-muted-fg)]">
                      {bsStatus}
                    </span>
                    <Button
                      size="sm"
                      disabled={bsBusy || !bsDirty}
                      onClick={saveAdvanced}
                    >
                      {t("settings.saveAdvanced")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
