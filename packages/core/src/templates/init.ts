// Template source for `typren init` (see ../cli.ts). Kept as plain string
// constants — not real .ts/.tsx module source — so tsc never tries to
// typecheck the *scaffolded* code against this package's own dependency
// graph (it's meant to run inside a *consumer* project with different
// aliases/deps). This file itself is ordinary TS and is built to dist like
// any other module.

// Marker strings embedded as comments in the generated next.config.ts /
// cms.config.ts. `typren apply-settings` (see ../cli.ts) greps a host's
// existing files for these to decide "already wired" vs "needs manual update"
// without parsing TS — cheap and never gives a false "wired" on a hand-rolled
// config that merely happens to import the same package functions.
export const TYPREN_REWRITE_MARKER = "typren:admin-route-rewrite";
export const TYPREN_BOOTSTRAP_MARKER = "typren:bootstrap-wired";

const typrenConfigJson = `{
  "adminRoute": "editor",
  "locales": ["en"],
  "defaultLocale": "en",
  "routing": "prefix-except-default",
  "onboarded": false
}
`;

// Always scaffolded at the project root (see the "/"-prefixed keys in
// buildTemplates below) regardless of src/ vs root App Router layout — unlike
// cms.config.ts, next.config.ts can't live under src/, and importing JSON
// keeps the relative path from drifting with baseDir.
const nextConfigTs = `import type { NextConfig } from "next";
// ${TYPREN_REWRITE_MARKER} — \`typren apply-settings\` looks for this marker
// to confirm the admin-route rewrite below is already wired; don't remove it.
import bootstrap from "./typren.config.json";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: \`/\${bootstrap.adminRoute}/:path*\`, destination: "/editor/:path*" }];
  },
};

export default nextConfig;
`;

const cmsConfig = (contentDirLiteral: string) => `import "server-only";
import path from "node:path";
import {
  createFsMediaAdapter,
  createFsSettingsAdapter,
  createMarkdownAdapter,
  createSettingsStore,
  createStore,
  type CmsConfig,
} from "@typren/core";
import { localAuth } from "@typren/core/auth/local";
import { registry } from "@/slices/registry";
import { defaults } from "@/slices/defaults";
import { fieldSchema } from "@/slices/field-schema";

const contentDir = path.join(process.cwd(), "${contentDirLiteral}");

// ${TYPREN_BOOTSTRAP_MARKER} — adminRoute/locales/defaultLocale/routing live in
// typren.config.json at the project root (edit via Settings → Advanced, or by
// hand); read once here so they parameterize the adapter below. \`typren
// apply-settings\` looks for this marker to confirm the wiring is in place.
const bootstrap = createFsSettingsAdapter({ file: path.join(process.cwd(), "typren.config.json") }).readBootstrap();

/** The one object that wires typren into this project. */
export const cmsConfig: CmsConfig = {
  registry,
  defaults,
  fieldSchema,
  adapter: createMarkdownAdapter({
    contentDir,
    draftDir: path.join(contentDir, ".drafts"),
    locales: bootstrap.locales,
    defaultLocale: bootstrap.defaultLocale,
  }),
  previewPath: "/editor/preview",
  // Local-only gate: allows access in dev, fails closed in production (the
  // editor writes files). Swap for a real auth adapter later — see
  // "@typren/core/auth/next-auth" or "@typren/core/auth/clerk" — no other change needed.
  auth: localAuth(),
  mediaAdapter: createFsMediaAdapter({
    dir: path.join(process.cwd(), "public/img"),
    publicPath: "/img",
  }),
};

export const cmsStore = createStore(cmsConfig.adapter, { onPublish: cmsConfig.onPublish });

// Site settings for the admin shell's Settings section: the runtime half
// (brand/SEO/theme) is a reserved-slug doc in a private \`.typren/\` dir, the
// bootstrap half is the root JSON above. One instance, shared by the editor
// route (reads the snapshot) and its server actions (writes).
export const cmsSettings = createSettingsStore(cmsConfig);
`;

const editorLayout = `import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveAuth } from "@typren/core";
import { cmsConfig } from "@/cms.config";

// Never index the editor (or its preview). Real access control is authorize().
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Auth gate for everything under /editor, including the preview route. Adds
 * no visual chrome, so the preview inherits the root layout and the shell
 * paints its own full-screen surface over it.
 *
 * "read", not "admin", on purpose: being allowed into the editor shouldn't
 * imply site-reconfiguration rights. The Settings section gates on "admin"
 * itself, in the route below.
 */
export default async function EditorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await resolveAuth(cmsConfig).authorize({ action: "read" }))) notFound();
  return children;
}
`;

const editorActions = `"use server";

import {
  makeActions,
  resolveAuth,
  type PageContent,
  type SiteSettingsBootstrap,
  type SiteSettingsRuntime,
} from "@typren/core";
import { cmsConfig, cmsSettings } from "@/cms.config";

// The host owns the "use server" boundary; the package supplies the logic.
// Each handler re-checks authorize() inside makeActions — a Server Action is a
// public POST endpoint, so the gate cannot live in the UI alone. Every write
// carries the target \`locale\` (the default when omitted), so adding a locale in
// Settings → Advanced needs no change here.
const actions = makeActions(cmsConfig);

export async function saveDraft(slug: string, page: PageContent, baseVersion?: string, locale?: string) {
  return actions.saveDraft(slug, page, baseVersion, locale);
}

export async function discardDraft(slug: string, locale?: string) {
  return actions.discardDraft(slug, locale);
}

export async function publish(slug: string, baseVersion?: string, locale?: string) {
  return actions.publish(slug, baseVersion, locale);
}

export async function createPage(title: string, locale?: string) {
  return actions.createPage(title, locale);
}

export async function createTranslation(slug: string, toLocale: string) {
  return actions.createTranslation(slug, toLocale);
}

export async function deletePage(slug: string) {
  return actions.deletePage(slug);
}

export async function deleteTranslation(slug: string, locale: string) {
  return actions.deleteTranslation(slug, locale);
}

export async function listMedia() {
  return actions.listMedia();
}

export async function deleteMedia(id: string) {
  return actions.deleteMedia(id);
}

// Settings section. \`createSettingsStore\` gates saveDraft/publish on the
// distinct "admin" action itself, so these two only forward. \`writeBootstrap\`
// is a plain fs write with no gate baked in — the admin check for it has to
// live here, on the host's side of the wire.
export async function saveSettingsDraft(next: SiteSettingsRuntime, baseVersion?: string, locale?: string) {
  return cmsSettings.saveDraft(next, baseVersion, locale);
}

export async function publishSettings(baseVersion?: string, locale?: string) {
  return cmsSettings.publish(baseVersion, locale);
}

export async function writeBootstrap(patch: Partial<SiteSettingsBootstrap>) {
  if (!(await resolveAuth(cmsConfig).authorize({ action: "admin" }))) throw new Error("typren: unauthorized");
  cmsSettings.bootstrap.writeBootstrap(patch);
}
`;

const editorShellClient = `"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaAsset, Messages, PageContent, SaveResult } from "@typren/core";
import type {
  MediaSectionProps,
  PagesSectionProps,
  ResolvedSection,
  SectionCtx,
  SiteSettings,
  SiteSettingsBootstrap,
  SiteSettingsRuntime,
} from "@typren/editor";

/**
 * Mounts \`<typren-shell>\`, the admin shell.
 *
 * The whole \`SectionCtx\` is assembled HERE, on the client, not on the server:
 * every element that reads it runs in the browser, and the pieces that touch
 * disk (the content adapter, the slice registry of React components, the
 * settings store) can't cross the RSC boundary. So the route passes plain data
 * plus Server Action references, and this component closes over them.
 *
 * Consequence worth knowing: \`ctx.settings.get()\` / \`readBootstrap()\` are
 * synchronous in the package's interface, so they return the SERVER-RENDERED
 * snapshot — they don't re-read after a write. The route is \`force-dynamic\`, so
 * a reload is what refreshes them.
 */
export type ShellActions = Readonly<{
  saveDraft: (slug: string, page: PageContent, baseVersion?: string, locale?: string) => Promise<SaveResult>;
  discardDraft: (slug: string, locale?: string) => Promise<void>;
  publish: (slug: string, baseVersion?: string, locale?: string) => Promise<SaveResult>;
  createPage: (title: string, locale?: string) => Promise<string>;
  createTranslation: (slug: string, toLocale: string) => Promise<void>;
  deletePage: (slug: string) => Promise<void>;
  deleteTranslation: (slug: string, locale: string) => Promise<void>;
  listMedia: () => Promise<MediaAsset[]>;
  deleteMedia: (id: string) => Promise<void>;
  saveSettingsDraft: (next: SiteSettingsRuntime, baseVersion?: string, locale?: string) => Promise<SaveResult>;
  publishSettings: (baseVersion?: string, locale?: string) => Promise<SaveResult>;
  writeBootstrap: (patch: Partial<SiteSettingsBootstrap>) => Promise<void>;
}>;

type Props = Readonly<{
  sections: ResolvedSection[];
  activeId: string;
  basePath: string;
  snapshot: SiteSettings;
  locale: string;
  locales: string[];
  defaultLocale: string;
  messages?: Partial<Messages>;
  /** Set only when a media adapter is configured; also gates the Media section. */
  uploadPath?: string;
  pagesProps?: PagesSectionProps;
  mediaProps?: MediaSectionProps;
  actions: ShellActions;
}>;

/** The shell's own properties, set imperatively — a custom element takes
 *  non-string props by property assignment, not by attribute. */
type ShellElement = HTMLElement & {
  sections: ResolvedSection[];
  activeId: string;
  ctx: SectionCtx;
  pagesProps?: PagesSectionProps;
  mediaProps?: MediaSectionProps;
};

export default function EditorShellClient({
  sections,
  activeId,
  basePath,
  snapshot,
  locale,
  locales,
  defaultLocale,
  messages,
  uploadPath,
  pagesProps,
  mediaProps,
  actions,
}: Props) {
  const ref = useRef<HTMLElement>(null);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Client-only: importing "@typren/editor" is what defines the typren-*
    // custom elements. Dynamic so \`customElements.define\` never runs on the
    // server render.
    import("@typren/editor").then(() => {
      if (!cancelled) setRegistered(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ctx = useMemo<SectionCtx>(() => {
    const media = uploadPath ? { list: actions.listMedia, delete: actions.deleteMedia, uploadPath } : undefined;
    return {
      apiVersion: 1,
      // registry/adapter omitted on purpose — server-only handles nothing in the
      // shell reads client-side. Uploads go through \`uploadPath\`, not \`upload()\`.
      config: { mediaAdapter: media && { list: media.list, delete: media.delete } },
      actions: {
        saveDraft: actions.saveDraft,
        discardDraft: actions.discardDraft,
        publish: actions.publish,
        createPage: actions.createPage,
        createTranslation: actions.createTranslation,
        deletePage: actions.deletePage,
        deleteTranslation: actions.deleteTranslation,
      },
      collections: {},
      settings: {
        get: () => snapshot,
        saveDraft: actions.saveSettingsDraft,
        publish: actions.publishSettings,
        bootstrap: {
          readBootstrap: () => snapshot.bootstrap,
          writeBootstrap: actions.writeBootstrap,
        },
      },
      settingsSnapshot: snapshot,
      media,
      messages,
      locale,
      locales,
      defaultLocale,
      // Section switching is a full navigation (the nav's rows are plain
      // \`<a href>\`s); this is the programmatic path, e.g. after a create.
      navigate: (sectionId: string) => {
        window.location.href = \`\${basePath}/\${sectionId}\`;
      },
      // Replaced by the shell with one that reaches its own \`<typren-top-bar>\`.
      setTopBarAction: () => {},
      // This host wires no collections, so it claims no collection capability.
      capabilities: new Set<string>(),
    };
  }, [actions, basePath, defaultLocale, locale, locales, messages, snapshot, uploadPath]);

  useEffect(() => {
    const el = ref.current as ShellElement | null;
    if (!el || !registered) return;
    el.sections = sections;
    el.activeId = activeId;
    el.ctx = ctx;
    el.pagesProps = pagesProps;
    el.mediaProps = mediaProps;
  }, [registered, sections, activeId, ctx, pagesProps, mediaProps]);

  return registered ? (
    // @ts-expect-error custom element: no JSX intrinsic declared (the package's
    // HTMLElementTagNameMap entry types property access, not JSX).
    <typren-shell ref={ref} style={{ display: "flex", position: "fixed", inset: 0 }} />
  ) : null;
}
`;

const editorRoutePage = `import { notFound } from "next/navigation";
import { resolveAuth, resolveSections, type SiteSettings } from "@typren/core";
import { cmsConfig, cmsSettings, cmsStore } from "@/cms.config";
import EditorShellClient from "../shell-client";
import {
  createPage,
  createTranslation,
  deleteMedia,
  deletePage,
  deleteTranslation,
  discardDraft,
  listMedia,
  publish,
  publishSettings,
  saveDraft,
  saveSettingsDraft,
  writeBootstrap,
} from "../actions";

// Drafts and settings change on disk; never cache the admin shell.
export const dynamic = "force-dynamic";

const BASE_PATH = "/editor";
const UPLOAD_PATH = "/editor/media/upload";

/**
 * The single route behind the whole admin shell. Section ids and page slugs
 * share ONE flat namespace under /editor — that's the shell's own model: the
 * section nav links \`/editor/<sectionId>\` and its "New page" button jumps to
 * \`/editor/<slug>\`. So a segment resolves as a section first, then as a page
 * slug, and a section id wins over a page that happens to share its name.
 *
 * \`/editor\` and \`/editor/pages\` land on the page picker; \`/editor/<slug>\` edits
 * that page.
 */
export default async function EditorRoute({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ segment?: string[] }>;
  searchParams: Promise<{ locale?: string | string[] }>;
}>) {
  const { segment } = await params;
  const { locale: localeParam } = await searchParams;
  const locales = cmsConfig.adapter.locales ?? ["en"];
  const defaultLocale = cmsConfig.adapter.defaultLocale ?? locales[0];
  const locale =
    typeof localeParam === "string" && locales.includes(localeParam) ? localeParam : defaultLocale;

  // One segment only; deeper paths would be a second URL for the same view.
  if (segment && segment.length > 1) notFound();
  const first = segment?.[0];

  const sections = resolveSections(cmsConfig);
  const section = first ? sections.find((s) => s.id === first) : undefined;
  const pagesSection = sections.find((s) => s.kind === "pages");
  const active = section ?? pagesSection;
  if (!active) notFound();

  // Site reconfiguration reparameterizes what the next boot trusts, so the
  // Settings section needs the distinct "admin" action — the layout's gate is
  // "read", which is deliberately weaker (page editing shouldn't imply it).
  if (active.kind === "settings" && !(await resolveAuth(cmsConfig).authorize({ action: "admin" }))) {
    notFound();
  }

  const pages = cmsStore.listPages(locale);

  let pagesProps;
  if (active.kind === "pages") {
    // No slug (bare /editor, or the section's own id) → picker; the per-page
    // fields stay undefined and the shell renders \`<typren-page-list>\`.
    const slug = section ? undefined : first;
    // A page must exist in the default locale to be edited (translations are of
    // an existing default page).
    if (slug && !cmsConfig.adapter.exists(slug, defaultLocale)) notFound();
    const draft = slug ? cmsStore.getDraft(slug, locale) : undefined;
    const published = slug ? cmsStore.getPublished(slug, locale) : undefined;
    pagesProps = {
      slug,
      pages,
      initialPage: draft ?? published,
      initialVersion: slug ? cmsStore.currentVersion(slug, locale) : null,
      sliceNames: Object.keys(cmsConfig.registry),
      defaults: cmsConfig.defaults,
      fieldSchema: cmsConfig.fieldSchema,
      previewPath: cmsConfig.previewPath ?? \`\${BASE_PATH}/preview\`,
      translatedLocales: slug
        ? locales.filter((l) => cmsConfig.adapter.exists(slug, l) || cmsConfig.adapter.hasDraft(slug, l))
        : undefined,
      isFallback: !draft && (published?.isFallback ?? false),
    };
  }

  const snapshot: SiteSettings = {
    ...cmsSettings.get(locale),
    bootstrap: cmsSettings.bootstrap.readBootstrap(),
  };

  return (
    <EditorShellClient
      sections={sections}
      activeId={active.id}
      basePath={BASE_PATH}
      snapshot={snapshot}
      locale={locale}
      locales={locales}
      defaultLocale={defaultLocale}
      messages={cmsConfig.i18n?.messages?.[cmsConfig.i18n?.defaultLocale ?? "en"]}
      uploadPath={cmsConfig.mediaAdapter ? UPLOAD_PATH : undefined}
      pagesProps={pagesProps}
      mediaProps={{ pages, uploadPath: UPLOAD_PATH }}
      actions={{
        saveDraft,
        discardDraft,
        publish,
        createPage,
        createTranslation,
        deletePage,
        deleteTranslation,
        listMedia,
        deleteMedia,
        saveSettingsDraft,
        publishSettings,
        writeBootstrap,
      }}
    />
  );
}
`;

const editorPreviewBridge = `"use client";

import { useEffect } from "react";
import { initPreviewBridge } from "@typren/editor";

/** Click-to-select + inline-edit wiring for the preview iframe. The bridge
 *  itself is framework-free in the package (plain DOM listeners); this is only
 *  its mount point. */
export default function PreviewBridge() {
  useEffect(() => initPreviewBridge(), []);
  return null;
}
`;

const editorPreviewSlugPage = `import { notFound } from "next/navigation";
import { resolveAuth } from "@typren/core";
import { cmsConfig, cmsStore } from "@/cms.config";
import { SliceZone } from "@/slices/slice-zone";
import PreviewBridge from "../bridge";

// Renders the draft (falling back to published) with the site's real layout —
// this is what the editor iframes for a true WYSIWYG preview. Each slice is
// wrapped with data-typren-index so it's click-selectable on the canvas.
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  // Belt and braces: \`app/editor/layout.tsx\` already gates everything under
  // /editor on authorize({read}), this route included, so this check is
  // redundant. Kept because this route serves UNPUBLISHED drafts and a layout
  // gate is easy to lose in a refactor — noindex is not access control.
  if (!(await resolveAuth(cmsConfig).authorize({ action: "read" }))) notFound();

  const { slug } = await params;
  if (!cmsConfig.adapter.exists(slug)) notFound();
  const page = cmsStore.getDraft(slug) ?? cmsStore.getPublished(slug);
  return (
    <>
      {page.slices.map((s, i) => (
        <div key={\`\${s.slice}-\${i}\`} data-typren-index={i}>
          <SliceZone slices={[s]} />
        </div>
      ))}
      <PreviewBridge />
    </>
  );
}
`;

const editorMediaUploadRoute = `import { handleMediaUpload } from "@typren/core";
import { cmsConfig } from "@/cms.config";

// sharp needs Node's native bindings, not the edge runtime.
export const runtime = "nodejs";

// A Route Handler, not a Server Action — Next's default 1MB action body cap
// is the wrong shape for raw image bytes. It also bypasses
// \`app/editor/layout.tsx\`'s auth gate (Route Handlers don't participate in
// layouts), so \`handleMediaUpload\` re-checks \`resolveAuth(cmsConfig)\` itself.
export async function POST(request: Request) {
  return handleMediaUpload(cmsConfig, request);
}
`;

const slicesRegistry = `import type { ComponentType } from "react";
import { Hero } from "./hero";
import { Prose } from "./prose";

/** Slice name (as authored in content frontmatter) -> component. Add new
 *  slices here, plus a starter entry in defaults.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<string, ComponentType<any>> = {
  hero: Hero,
  prose: Prose,
};
`;

const slicesDefaults = `/** Starter props inserted when a slice is added in the editor. Keyed by
 * registry slice name; each value renders without crashing. */
export const defaults: Record<string, Record<string, unknown>> = {
  hero: {
    heading: "Your headline here.",
    body: "A short supporting sentence.",
    cta: { label: "Get started", href: "/" },
  },
  prose: {
    heading: "About this section",
    body: "Add your rich-text content here.",
  },
};
`;

const slicesFieldSchema = `import type { SliceSchema } from "@typren/core";

/** Per-slice field hints for the editor. Fields listed here render as typed
 * controls (mainly dropdowns for string-literal unions); everything else
 * falls back to auto-detection. Keyed by slice name, then by prop name. */
export const fieldSchema: Record<string, SliceSchema> = {
  hero: {
    align: { type: "select", options: ["left", "center"] },
  },
};
`;

const slicesSliceZone = `import type { Slice } from "@typren/core";
import { registry } from "./registry";

/** Render an ordered list of content slices via the registry. */
export function SliceZone({ slices }: Readonly<{ slices: Slice[] }>) {
  return slices.map((s, i) => {
    const Component = registry[s.slice];
    if (!Component) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(\`[SliceZone] unknown slice "\${s.slice}"\`);
      }
      return null;
    }
    return <Component key={\`\${s.slice}-\${i}\`} {...s} />;
  });
}
`;

const slicesHero = `type Cta = { label: string; href: string };
type Props = Readonly<{
  heading: string;
  body: string;
  cta?: Cta;
  align?: "left" | "center";
}>;

/** Example slice — replace with your own. Shows a typed props shape, an
 *  optional CTA, and a \`select\`-typed prop (see field-schema.ts). */
export function Hero({ heading, body, cta, align = "left" }: Props) {
  const centered = align === "center";
  return (
    <section className={centered ? "px-6 py-24 text-center" : "px-6 py-24"}>
      <div className={centered ? "mx-auto max-w-3xl" : "mx-auto max-w-xl"}>
        <h1 className="text-4xl font-bold">{heading}</h1>
        <p className="mt-4 text-lg text-gray-600">{body}</p>
        {cta && (
          <a href={cta.href} className="mt-8 inline-block rounded-full bg-black px-6 py-3 font-medium text-white">
            {cta.label}
          </a>
        )}
      </div>
    </section>
  );
}
`;

const slicesProse = `type Props = Readonly<{ heading?: string; body: string }>;

/** Example slice — replace with your own. A minimal text block. */
export function Prose({ heading, body }: Props) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-2xl">
        {heading && <h2 className="text-2xl font-semibold">{heading}</h2>}
        <p className="mt-4 whitespace-pre-line text-gray-700">{body}</p>
      </div>
    </section>
  );
}
`;

const contentHome = `---
title: Home
slices:
  - slice: hero
    heading: Welcome to your new site
    body: Edit this page at /editor to change this content.
    cta: { label: Open the editor, href: /editor }
  - slice: prose
    heading: About this section
    body: Add your rich-text content here.
---
`;

const contentSite = `---
title: Site settings
---
`;

/** Every file \`typren init\` scaffolds, keyed by path relative to the
 *  detected project base dir ("src" when the project has \`src/app\`, "."
 *  when it has a root-level \`app\`). \`contentDirLiteral\` is the same base
 *  dir joined with "content" (e.g. "src/content" or "content"). A key
 *  starting with "/" is project-ROOT-relative regardless of baseDir (see
 *  ../cli.ts's \`scaffold\`) — used for next.config.ts/typren.config.json,
 *  which can never live under src/. */
export function buildTemplates(contentDirLiteral: string): Record<string, string> {
  return {
    "/typren.config.json": typrenConfigJson,
    "/next.config.ts": nextConfigTs,
    "cms.config.ts": cmsConfig(contentDirLiteral),
    "app/editor/layout.tsx": editorLayout,
    "app/editor/actions.ts": editorActions,
    "app/editor/shell-client.tsx": editorShellClient,
    // One optional catch-all owns every admin surface: `/editor` (page picker),
    // `/editor/<sectionId>` and `/editor/<slug>`. It must be the ONLY `page` at
    // this level — a sibling `app/editor/page.tsx` is a same-specificity route
    // conflict Next rejects outright.
    "app/editor/[[...segment]]/page.tsx": editorRoutePage,
    "app/editor/preview/bridge.tsx": editorPreviewBridge,
    "app/editor/preview/[slug]/page.tsx": editorPreviewSlugPage,
    "app/editor/media/upload/route.ts": editorMediaUploadRoute,
    "slices/registry.ts": slicesRegistry,
    "slices/defaults.ts": slicesDefaults,
    "slices/field-schema.ts": slicesFieldSchema,
    "slices/slice-zone.tsx": slicesSliceZone,
    "slices/hero.tsx": slicesHero,
    "slices/prose.tsx": slicesProse,
    "content/home.md": contentHome,
    "content/site.md": contentSite,
  };
}
