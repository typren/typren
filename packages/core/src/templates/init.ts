// Template source for `typren init` (see ../cli.ts). Kept as plain string
// constants, not real .ts/.tsx module source, so tsc never tries to
// typecheck the *scaffolded* code against this package's own dependency
// graph (it's meant to run inside a *consumer* project with different
// aliases/deps). This file itself is ordinary TS and is built to dist like
// any other module.

// Marker string embedded as a comment in the generated cms.config.ts.
// `typren apply-settings` (see ../cli.ts) greps a host's existing file for it
// to decide "already wired" vs "needs manual update" without parsing TS, which
// is cheap and never gives a false "wired" on a hand-rolled config that merely
// happens to import the same package functions.
export const TYPREN_BOOTSTRAP_MARKER = "typren:bootstrap-wired";

const typrenConfigJson = `{
  "locales": ["en"],
  "defaultLocale": "en",
  "routing": "prefix-except-default",
  "onboarded": false
}
`;

const cmsConfig = (contentDirLiteral: string) => `import "server-only";
import path from "node:path";
import {
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

// ${TYPREN_BOOTSTRAP_MARKER}: locales/defaultLocale/routing live in
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
  // Editing happens in \`typren studio\`, which frames this site's own pages,
  // so the site needs no preview route of its own.
  previewPath: "/",
  // This site writes nothing (the studio does), but CmsConfig needs a gate:
  // localAuth fails closed everywhere except a loopback-bound dev server.
  auth: localAuth(),
};

export const cmsStore = createStore(cmsConfig.adapter, { onPublish: cmsConfig.onPublish });

/** True while \`typren studio\` is previewing this site: the dev server was
 *  started with TYPREN_PREVIEW=1. Never true in a production build, so drafts
 *  and the studio bridge can't ship. */
export const studioPreview = process.env.TYPREN_PREVIEW === "1" && process.env.NODE_ENV !== "production";

/** The page to render: its draft while the studio previews, else published. */
export async function getPage(slug: string, locale?: string) {
  return (studioPreview && (await cmsStore.getDraft(slug, locale))) || cmsStore.getPublished(slug, locale);
}
`;

const seoConfig = `import "server-only";
import { createSettingsStore } from "@typren/core";
import { resolveSeoConfig, type SeoConfig } from "@typren/core/seo";
import { cmsConfig } from "@/cms.config";

// Code defaults: the fallback for anything left blank in Site Settings.
// A value saved in Settings (site name, logo, SEO title template, description,
// social image) wins over the matching field here.
const codeDefaults: SeoConfig = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  siteName: "My site",
  entityDescription: "What this site or organisation is, in a sentence or two.",
  defaultTitle: "My site",
  defaultDescription: "A short description for search results.",
};

const settings = createSettingsStore(cmsConfig);

/** The SEO config with saved Site Settings applied. Use it wherever a
 *  SeoConfig is expected: \`buildRootMetadata\` in the root layout's
 *  \`generateMetadata\`, \`buildMetadata\`, \`organizationJsonLd\`,
 *  \`buildSitemap\`, \`buildRobots\`. */
export const getSeoConfig = (locale?: string) => resolveSeoConfig(codeDefaults, settings, locale);
`;

const siteStyle = `import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createSettingsStore, type StyleMap } from "@typren/core";
import { TyprenStyle } from "@typren/core/ui/typren-style";
import { cmsConfig } from "@/cms.config";

const settings = createSettingsStore(cmsConfig);

/** \`studio.style\` in typren.config.json: which of your own CSS variables
 *  each Style token drives. Read from disk, not imported, so the file can sit
 *  outside the bundle's root and a change needs no rebuild. Without it, the
 *  stock shadcn names. */
function styleMap(): StyleMap | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "typren.config.json"), "utf8")).studio?.style;
  } catch {
    return undefined;
  }
}

/** The Style tokens saved in \`typren studio\`, as a <style> React hoists
 *  into <head>. SliceZone renders it, so every content page carries it; put
 *  it in your root layout too if other routes should. */
export function SiteStyle({ locale }: Readonly<{ locale?: string }>) {
  return <TyprenStyle store={settings} map={styleMap()} locale={locale} />;
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
 * renders without crashing. \`typren studio\` inserts these when a block is
 * added, and its keys are the studio's slice list. The CLI imports this file
 * with Node's type stripping, so keep it free of value imports and JSX. */
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
 * auto-detection. Read by \`typren studio\` the same way as defaults.ts:
 * type imports only. */
export const fieldSchema: Record<string, SliceSchema> = {
  hero: {
    align: { type: "select", options: ["left", "center"] },
  },
};
`;

const slicesSliceZone = `import type { Slice } from "@typren/core";
import { studioPreview } from "@/cms.config";
import { registry } from "./registry";
import { StudioBridge } from "@typren/core/ui/studio-bridge";
import { SiteStyle } from "@/site-style";

/** Render an ordered list of content slices via the registry, with the
 *  site's saved Style. While the studio previews (see \`studioPreview\`), each
 *  slice gets a \`data-typren-index\` wrapper and the page loads the studio
 *  bridge, so clicking a block selects it in the editor. Render one SliceZone
 *  per page. */
export function SliceZone({ slices }: Readonly<{ slices: Slice[] }>) {
  const rendered = slices.map((s, i) => {
    const Component = Object.hasOwn(registry, s.slice) ? registry[s.slice] : undefined;
    if (!Component) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(\`[SliceZone] unknown slice "\${s.slice}"\`);
      }
      return null;
    }
    const key = \`\${s.slice}-\${i}\`;
    return studioPreview ? (
      <div key={key} data-typren-index={i}>
        <Component {...s} />
      </div>
    ) : (
      <Component key={key} {...s} />
    );
  });
  return (
    <>
      <SiteStyle />
      {rendered}
      {studioPreview && <StudioBridge origin={process.env.TYPREN_STUDIO_ORIGIN} />}
    </>
  );
}
`;

const sectionRoute = `import { createSectionCanvas } from "@typren/core/ui/section-canvas";
import { cmsConfig } from "@/cms.config";

/** One slice rendered alone: \`typren studio\` frames this for section
 *  thumbnails. It renders only while the studio previews; the root layout
 *  still wraps it, so hide any site header or footer for this route there. */
export default createSectionCanvas(cmsConfig.registry);
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
    body: Edit this page with \`typren studio\`, or change ${contentDirLiteral}/home.md directly.
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
 *  ../cli.ts's \`scaffold\`), used for typren.config.json, which can never
 *  live under src/. */
export function buildTemplates(contentDirLiteral: string): Record<string, string> {
  return {
    "/typren.config.json": typrenConfigJson,
    "cms.config.ts": cmsConfig(contentDirLiteral),
    "seo.ts": seoConfig,
    "site-style.tsx": siteStyle,
    "slices/registry.ts": slicesRegistry,
    "slices/defaults.ts": slicesDefaults,
    "slices/field-schema.ts": slicesFieldSchema,
    "slices/slice-zone.tsx": slicesSliceZone,
    "app/typren/section/page.tsx": sectionRoute,
    "slices/hero.tsx": slicesHero,
    "slices/prose.tsx": slicesProse,
    "content/home.md": contentHome(contentDirLiteral),
    "content/site.md": contentSite,
  };
}
