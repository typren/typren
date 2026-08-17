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
  createStore,
  type CmsConfig,
} from "@typren/core";
import { localAuth } from "@typren/core/auth/local";
import { registry } from "@/slices/registry";
import { defaults } from "@/slices/defaults";
import { fieldSchema } from "@/slices/field-schema";

const contentDir = path.join(process.cwd(), "${contentDirLiteral}");

// ${TYPREN_BOOTSTRAP_MARKER}: adminRoute/locales/defaultLocale/routing live in
// typren.config.json at the project root (edit it by hand, then run \`typren
// apply-settings\`). They are read once here to parameterize the adapter
// below. \`typren apply-settings\` also greps for this marker to confirm the
// wiring is in place.
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
 * imply site-reconfiguration rights, so any future admin-only surface must
 * run its own authorize({ action: "admin" }) check where it mounts.
 */
export default async function EditorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await resolveAuth(cmsConfig).authorize({ action: "read" }))) notFound();
  return children;
}
`;

const editorActions = `"use server";

import { makeActions, type PageContent } from "@typren/core";
import { cmsConfig } from "@/cms.config";

// The host owns the "use server" boundary; the package supplies the logic.
// Each handler re-checks authorize() inside makeActions, because a Server
// Action is a public POST endpoint, so the gate cannot live in the UI alone.
// Every write carries the target \`locale\` (the default when omitted), so
// adding a locale to typren.config.json needs no change here.
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

// These two back FieldForm's image picker inside the Pages loop; the editor
// has no separate media-library section yet.
export async function listMedia() {
  return actions.listMedia();
}

export async function deleteMedia(id: string) {
  return actions.deleteMedia(id);
}
`;

const editorShellClient = `"use client";

import { useRouter } from "next/navigation";
import type { FieldFormMedia, PageActions, PageContent, PageInfo, SliceSchema } from "@typren/core";
import { TyprenEditor } from "@typren/editor";

const BASE_PATH = "/editor";

/**
 * Mounts \`TyprenEditor\`, the Pages editing loop: the page picker when no page
 * is open, or the block/field/preview shell once one is.
 *
 * The editor's \`host\` object is assembled HERE, on the client, not on the
 * server: the editor calls its actions from browser event handlers, and the
 * pieces that touch disk (the content adapter, the slice registry of React
 * components) can't cross the RSC boundary. So the route passes plain data
 * plus Server Action references, and this component closes over them.
 */
type Props = Readonly<{
  pages: PageInfo[];
  /** Slug of the page being edited; omitted on the page picker. */
  slug?: string;
  /** That page's draft (falling back to published) content, loaded server-side. */
  page?: PageContent;
  /** Optimistic-lock version \`page\` was loaded at. */
  version?: string | null;
  /** Set only when editing a non-default locale; kept in the URL on navigation. */
  locale?: string;
  sliceNames: string[];
  defaults: Record<string, Record<string, unknown>>;
  fieldSchema?: Record<string, SliceSchema>;
  previewPath: string;
  /** Set only when a media adapter is configured; wires image fields to the
   *  media library. When omitted they degrade to plain text inputs. */
  media?: FieldFormMedia;
  actions: PageActions;
}>;

export default function EditorShellClient({
  pages,
  slug,
  page,
  version,
  locale,
  sliceNames,
  defaults,
  fieldSchema,
  previewPath,
  media,
  actions,
}: Props) {
  const router = useRouter();
  const search = locale ? \`?locale=\${locale}\` : "";
  return (
    <TyprenEditor
      // Keyed by slug so switching pages remounts the editor: its draft state
      // initializes from \`page\`, and a client-side transition alone would keep
      // the previous page's blocks on screen.
      key={slug ?? "picker"}
      host={{ actions, sliceNames, defaults, fieldSchema, previewPath, media }}
      pages={pages}
      slug={slug}
      page={page}
      version={version}
      locale={locale}
      onNavigate={(next) => router.push(next ? \`\${BASE_PATH}/\${next}\${search}\` : \`\${BASE_PATH}\${search}\`)}
      // The editor asks the host to refresh "this page" after a discard,
      // publish, or conflict reload. A full reload is the simplest way to
      // guarantee content and version are both re-read from disk.
      onReload={() => window.location.reload()}
    />
  );
}
`;

const editorRoutePage = `import { notFound } from "next/navigation";
import { cmsConfig, cmsStore } from "@/cms.config";
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
  saveDraft,
} from "../actions";

// Drafts change on disk; never cache the editor.
export const dynamic = "force-dynamic";

const UPLOAD_PATH = "/editor/media/upload";

/**
 * The single route behind the editor: \`/editor\` is the page picker and
 * \`/editor/<slug>\` edits that page. \`?locale=\` switches the content locale
 * for reads and writes (single-locale sites never set it).
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
  const slug = segment?.[0];

  // A page must exist in the default locale to be edited (translations are of
  // an existing default page).
  if (slug && !cmsConfig.adapter.exists(slug, defaultLocale)) notFound();

  const pages = cmsStore.listPages(locale);
  const page = slug ? (cmsStore.getDraft(slug, locale) ?? cmsStore.getPublished(slug, locale)) : undefined;

  return (
    <EditorShellClient
      pages={pages}
      slug={slug}
      page={page}
      version={slug ? cmsStore.currentVersion(slug, locale) : null}
      locale={locale === defaultLocale ? undefined : locale}
      sliceNames={Object.keys(cmsConfig.registry)}
      defaults={cmsConfig.defaults}
      fieldSchema={cmsConfig.fieldSchema}
      previewPath={cmsConfig.previewPath}
      media={cmsConfig.mediaAdapter ? { list: listMedia, delete: deleteMedia, uploadPath: UPLOAD_PATH } : undefined}
      actions={{ saveDraft, discardDraft, publish, createPage, createTranslation, deletePage, deleteTranslation }}
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
    // One optional catch-all owns both editor surfaces: `/editor` (the page
    // picker) and `/editor/<slug>` (editing that page). It must be the ONLY
    // `page` at this level, because a sibling `app/editor/page.tsx` is a
    // same-specificity route conflict Next rejects outright.
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
