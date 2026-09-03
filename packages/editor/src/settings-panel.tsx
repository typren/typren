"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import type { MediaAsset, SiteSettings, SiteSettingsBootstrap, SiteSettingsRuntime, Slice, SliceSchema } from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import type { TyprenEditorSettingsActions } from "./types";
import { FieldForm } from "./field-form";
import { useT } from "./intl";
import { Button } from "./primitives/button";

const RUNTIME_SCHEMA: SliceSchema = {
  "brand.name": { type: "text", label: "Site name" },
  "brand.logo": { type: "image", label: "Logo" },
  "brand.logoDark": { type: "image", label: "Logo (dark surfaces)" },
  "seo.titleTemplate": { type: "text", label: "SEO title template" },
  "seo.description": { type: "textarea", label: "SEO description" },
  "seo.ogImage": { type: "image", label: "Social share image" },
  "theme.preset": { type: "select", options: ["shadcn", "neutral"], label: "Theme preset" },
};

const ADVANCED_SCHEMA: SliceSchema = {
  adminRoute: { type: "text", label: "Admin route" },
  locales: { type: "yaml", label: "Locales" },
  defaultLocale: { type: "text", label: "Default locale" },
  routing: { type: "select", options: ["prefix-except-default", "prefix-all"], label: "Routing mode" },
};

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
    "theme.preset": rt.theme?.preset ?? "",
  };
}

function unflattenRuntime(flat: Record<string, unknown>): SiteSettingsRuntime {
  const name = String(flat["brand.name"] ?? "");
  const logoUrl = String(flat["brand.logo"] ?? "");
  const logoDarkUrl = String(flat["brand.logoDark"] ?? "");
  const titleTemplate = String(flat["seo.titleTemplate"] ?? "");
  const description = String(flat["seo.description"] ?? "");
  const ogImageUrl = String(flat["seo.ogImage"] ?? "");
  const preset = String(flat["theme.preset"] ?? "");
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
    ...(preset ? { theme: { preset: preset as NonNullable<SiteSettingsRuntime["theme"]>["preset"] } } : {}),
  };
}

function toBootstrapSlice(bs: SiteSettingsBootstrap): Slice {
  return { slice: "Advanced", adminRoute: bs.adminRoute, locales: bs.locales, defaultLocale: bs.defaultLocale, routing: bs.routing };
}

function fromBootstrapSlice(flat: Record<string, unknown>): Partial<SiteSettingsBootstrap> {
  const locales = Array.isArray(flat.locales) ? (flat.locales as unknown[]).map(String) : undefined;
  return {
    adminRoute: String(flat.adminRoute ?? "editor"),
    ...(locales ? { locales } : {}),
    defaultLocale: String(flat.defaultLocale ?? "en"),
    routing: flat.routing === "prefix-all" ? "prefix-all" : "prefix-except-default",
  };
}

/** SAFE_ROUTE-shaped regex + reserved-word check — same rule a future
 *  onboarding wizard's admin-route step would use (see core's `CmsConfig.onboarding`). */
function validateAdminRoute(route: string): string | null {
  if (!SAFE_ROUTE.test(route)) return "Admin route must start with a letter/digit and contain only letters, digits, or hyphens.";
  if (RESERVED_ROUTES.has(route.toLowerCase())) return `"${route}" is a reserved path and can't be used as the admin route.`;
  return null;
}

const EMPTY_RT: SiteSettingsRuntime = { brand: { name: "" }, seo: {} };
const EMPTY_BS: SiteSettingsBootstrap = {
  adminRoute: "editor",
  locales: ["en"],
  defaultLocale: "en",
  routing: "prefix-except-default",
  onboarded: false,
};

/**
 * The Settings section's body: maps the typed `SiteSettingsRuntime` fields
 * onto a flat `SliceSchema` and renders them through `FieldForm` verbatim (no
 * new form technology), with the same optimistic-lock conflict banner as
 * `EditorShell`. A separate collapsible "Advanced" panel edits the bootstrap
 * tier (adminRoute/locales/defaultLocale/routing) via `settings.writeBootstrap`
 * — see `TyprenEditorSettingsActions`'s doc comment for the auth boundary this
 * write crosses. Ported from meditor's `<meditor-settings>`.
 */
export function SettingsPanel({
  settings,
  snapshot,
  version: initialVersion = null,
  media,
  locale,
  onReload,
}: Readonly<{
  settings?: TyprenEditorSettingsActions;
  /** Host-fetched `{...SiteSettingsRuntime, bootstrap}` snapshot — a sync
   *  server read (`SettingsStore.get()`/`bootstrap.readBootstrap()`), so the
   *  host pre-fetches it, same pattern `page`/`initialVersion` use for Pages. */
  snapshot?: SiteSettings;
  version?: string | null;
  media?: FieldFormMedia;
  locale?: string;
  onReload: () => void;
}>) {
  const t = useT();
  const [rt, setRt] = useState<SiteSettingsRuntime>(snapshot ?? EMPTY_RT);
  const [bs, setBs] = useState<SiteSettingsBootstrap>(snapshot?.bootstrap ?? EMPTY_BS);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [version, setVersion] = useState(initialVersion);
  const [conflict, setConflict] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bsDirty, setBsDirty] = useState(false);
  const [bsBusy, setBsBusy] = useState(false);
  const [bsStatus, setBsStatus] = useState("");
  const [initialAdminRoute] = useState(bs.adminRoute);

  if (!settings) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center text-sm text-[var(--typren-muted-fg)]">
        Settings aren’t configured for this site.
      </div>
    );
  }

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

  const saveDraft = () =>
    run(t("shell.saveDraft"), async () => {
      const res = await settings.saveDraft(rt, version ?? undefined, locale);
      if (!res.ok) {
        setConflict(true);
        setStatus("");
        return;
      }
      setVersion(res.version);
      setDirty(false);
      setStatus(t("shell.draftSaved"));
    });

  const publish = () =>
    run(t("shell.publish"), async () => {
      const saved = await settings.saveDraft(rt, version ?? undefined, locale);
      if (!saved.ok) {
        setConflict(true);
        setStatus("");
        return;
      }
      setVersion(saved.version);
      const pub = await settings.publish(saved.version, locale);
      if (!pub.ok) {
        setConflict(true);
        setStatus("");
        return;
      }
      setDirty(false);
      onReload();
    });

  const overwrite = async () => {
    setBusy(true);
    setStatus(t("shell.overwriting"));
    try {
      const res = await settings.saveDraft(rt, undefined, locale);
      if (res.ok) {
        setVersion(res.version);
        setConflict(false);
        setDirty(false);
        setStatus(t("shell.draftSaved"));
      }
    } finally {
      setBusy(false);
    }
  };

  const onFieldChange = (next: Slice) => {
    const { slice: _drop, ...flat } = next;
    void _drop;
    setRt(unflattenRuntime(flat));
    setDirty(true);
    setStatus("");
  };

  const onBsFieldChange = (next: Slice) => {
    const { slice: _drop, ...flat } = next;
    void _drop;
    setBs((prev) => ({ ...prev, ...fromBootstrapSlice(flat) }));
    setBsDirty(true);
    setBsStatus("");
  };

  const saveAdvanced = async () => {
    const err = validateAdminRoute(bs.adminRoute);
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
      await settings.writeBootstrap({ adminRoute, locales, defaultLocale, routing });
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
  const adminRouteChanged = bs.adminRoute !== initialAdminRoute;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--typren-border)] px-4 py-2">
        <span className="text-sm font-semibold">{t("settings.title")}</span>
        <span className="text-xs text-[var(--typren-muted-fg)]">
          {dirty ? t("shell.unsaved") : status || t("shell.upToDate")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy || !dirty} onClick={saveDraft}>
            {t("shell.saveDraft")}
          </Button>
          <Button size="sm" disabled={busy || conflict} onClick={publish}>
            {t("shell.publish")}
          </Button>
        </div>
      </header>

      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-[var(--typren-border)] bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]"
        >
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
      )}

      {adminRouteChanged && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-[var(--typren-border)] bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]"
        >
          <TriangleAlert className="size-4 shrink-0 text-[var(--typren-muted-fg)]" aria-hidden />
          <span className="min-w-0 flex-1">{t("settings.adminRouteChanged")}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-6">
          <p className="mb-4 text-sm text-[var(--typren-muted-fg)]">{t("settings.blurb")}</p>
          <FieldForm slice={runtimeSlice} schema={RUNTIME_SCHEMA} onChange={onFieldChange} media={media} />

          <hr className="my-6 border-[var(--typren-border)]" />

          <Button
            variant="ghost"
            size="sm"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? <ChevronUp /> : <ChevronDown />} {t("settings.advanced")}
          </Button>

          {advancedOpen && (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-[var(--typren-muted-fg)]">{t("settings.advancedBlurb")}</p>
              <FieldForm slice={advancedSlice} schema={ADVANCED_SCHEMA} onChange={onBsFieldChange} />
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--typren-muted-fg)]">{bsStatus}</span>
                <Button size="sm" disabled={bsBusy || !bsDirty} onClick={saveAdvanced}>
                  {t("settings.saveAdvanced")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
