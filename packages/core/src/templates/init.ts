// Template source for `typren init` (see ../cli.ts). Kept as plain string
// constants, not real .ts/.tsx module source, so tsc never tries to
// typecheck the *scaffolded* code against this package's own dependency
// graph (it's meant to run inside a *consumer* project with different
// aliases/deps). This file itself is ordinary TS and is built to dist like
// any other module.

// Marker strings embedded as comments in the generated next.config.ts /
// cms.config.ts. `typren apply-settings` (see ../cli.ts) greps a host's
// existing files for these to decide "already wired" vs "needs manual update"
// without parsing TS, which is cheap and never gives a false "wired" on a hand-rolled
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
// buildTemplates below) regardless of src/ vs root App Router layout. Unlike
// cms.config.ts, next.config.ts can't live under src/, and importing JSON
// keeps the relative path from drifting with baseDir.
const nextConfigTs = `import type { NextConfig } from "next";
// ${TYPREN_REWRITE_MARKER}: \`typren apply-settings\` looks for this marker
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
  // Required by CmsConfig regardless; nothing renders this path in this
  // scaffold (no editor ships yet), kept as a stable target for when one does.
  previewPath: "/editor/preview",
  // Local-only gate: allows access in dev, fails closed in production
  // (saveDraft/publish and the upload route write files). Swap for a real
  // auth adapter later. See "@typren/core/auth/next-auth" or
  // "@typren/core/auth/clerk", no other change needed.
  auth: localAuth(),
  mediaAdapter: createFsMediaAdapter({
    dir: path.join(process.cwd(), "public/img"),
    publicPath: "/img",
  }),
};

export const cmsStore = createStore(cmsConfig.adapter, { onPublish: cmsConfig.onPublish });
`;

const cmsActions = `"use server";

import { makeActions, type PageContent } from "@typren/core";
import { cmsConfig } from "@/cms.config";

// No editor UI drives these: they are the write surface for programmatic and
// agent-driven content management (a review/PR pipeline, a script, or a
// future admin tool). The host still owns the "use server" boundary; the
// package supplies the logic. Each handler re-checks authorize() inside
// makeActions, because a Server Action is a public POST endpoint, so the
// gate cannot live in a UI layout alone. Every write carries the target
// \`locale\` (the default when omitted), so adding a locale to
// typren.config.json needs no change here.
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

// Lists/deletes existing media under the configured mediaAdapter. Pairs with
// the upload endpoint in mediaUploadRoute below for programmatic media
// management; this scaffold ships no media-library UI.
export async function listMedia() {
  return actions.listMedia();
}

export async function deleteMedia(id: string) {
  return actions.deleteMedia(id);
}
`;

const mediaUploadRoute = `import { handleMediaUpload } from "@typren/core";
import { cmsConfig } from "@/cms.config";

// sharp needs Node's native bindings, not the edge runtime.
export const runtime = "nodejs";

// A Route Handler, not a Server Action: Next's default 1MB action body cap is
// the wrong shape for raw image bytes. No editor ships in this scaffold (no
// image picker calls this), so this is a standalone, auth-gated programmatic
// upload endpoint for agent-driven media additions, mirroring cms-actions.ts's
// saveDraft/publish for content. handleMediaUpload re-checks
// resolveAuth(cmsConfig) itself, so this route is fully self-gated.
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

const slicesDefaults = `/** Starter props for each registered slice, keyed by slice name; each value
 * renders without crashing. Used by tooling that inserts a new slice
 * instance (there is no editor UI in this scaffold). */
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

/** Per-slice field hints, keyed by slice name then prop name (mainly
 * dropdowns for string-literal unions); everything else falls back to
 * auto-detection. Consumed by @typren/editor's field controls once that
 * package is installed; inert until then. */
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

/** Example slice. Replace with your own. Shows a typed props shape, an
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

/** Example slice. Replace with your own. A minimal text block. */
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

const contentHome = (contentDirLiteral: string) => `---
title: Home
slices:
  - slice: hero
    heading: Welcome to your new site
    body: Edit this page by changing ${contentDirLiteral}/home.md and opening a PR.
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
 *  ../cli.ts's \`scaffold\`), used for next.config.ts/typren.config.json,
 *  which can never live under src/. */
export function buildTemplates(contentDirLiteral: string): Record<string, string> {
  return {
    "/typren.config.json": typrenConfigJson,
    "/next.config.ts": nextConfigTs,
    "cms.config.ts": cmsConfig(contentDirLiteral),
    // Not scoped to app/ (no route imports it): a plain "use server" module
    // that's the write surface for programmatic/agent-driven content changes.
    "cms-actions.ts": cmsActions,
    "app/media/upload/route.ts": mediaUploadRoute,
    "slices/registry.ts": slicesRegistry,
    "slices/defaults.ts": slicesDefaults,
    "slices/field-schema.ts": slicesFieldSchema,
    "slices/slice-zone.tsx": slicesSliceZone,
    "slices/hero.tsx": slicesHero,
    "slices/prose.tsx": slicesProse,
    "content/home.md": contentHome(contentDirLiteral),
    "content/site.md": contentSite,
  };
}
