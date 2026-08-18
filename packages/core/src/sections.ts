import type { ComponentType } from "react";
import type { ContentAdapter, MediaAdapter, MediaAsset, SliceSchema } from "./types";
import type { PageActions } from "./actions";
import type { Messages } from "./i18n";
import type { SiteSettings, SettingsStore } from "./settings";

// ponytail: the predecessor's custom-element editor shell (and the element
// `FieldFormMedia` was originally declared on) was dropped from this port;
// @typren/editor is a fresh React implementation. `icon` is untyped until
// that package defines its own icon contract; `FieldFormMedia` is inlined
// here (it was never more than this shape) so SectionCtx doesn't have to
// import a UI package to describe its own server-safe media capability.
// Upgrade: re-type `icon` once @typren/editor settles, and re-export
// FieldFormMedia from there too.
export type FieldFormMedia = {
  list: () => Promise<MediaAsset[]>;
  delete: (id: string) => Promise<void>;
  uploadPath: string;
};

/** Bump ONLY on a breaking change to SectionCtx or the custom mount/element
 *  calling convention. A custom section can runtime-check this and degrade
 *  instead of crashing. Adding a new BUILT-IN kind is additive and never bumps
 *  this (see the switch convention in the spec). */
export const SECTION_API_VERSION = 1 as const;

interface SectionBase {
  /** Stable identity for nav highlighting + the `/editor/<id>` route segment.
   *  Defaults: built-in singletons use `kind`; collection/custom fall back to
   *  slug(label) but SHOULD be set so renaming `label` never breaks a link. */
  id?: string;
  label: string;
  /** Inline lucide svg from icons.ts, or omit for a kind-default icon. */
  icon?: unknown;
  /** Figma "Content" / "Other" grouping. Open string: unknown groups render
   *  in registration order after the known ones, never dropped. */
  group?: "content" | "other" | (string & {});
}

export interface PagesSection extends SectionBase {
  kind: "pages";
}
export interface MediaSection extends SectionBase {
  kind: "media";
}
export interface SettingsSection extends SectionBase {
  kind: "settings";
}

export interface CollectionSection extends SectionBase {
  kind: "collection";
  /** Repo-relative dir, e.g. "content/authors". Gets its OWN ContentAdapter
   *  instance. MUST NOT resolve inside the Pages contentDir (guarded at
   *  buildCollectionActions time, throws loud). */
  dir: string;
  /** Reuses FieldDef/SliceSchema verbatim: a record IS a slice-shaped prop bag. */
  schema: SliceSchema;
  /** Which schema key is the list-view primary column. Default: "title", then
   *  the first schema key, then the slug. */
  titleField?: string;
  /** Explicit list columns. Default: first 4 schema keys, title-cased. */
  columns?: string[];
}

export interface CustomSection extends SectionBase {
  kind: "custom";
  /** Provide EXACTLY ONE of element/mount/host (validated at resolveSections
   *  time, throws loud on more or none). `element` = a registered custom element
   *  tag (config-serializable, AI-authorable as a string); `mount` = imperative
   *  fallback, returning an optional cleanup fn called on section switch. */
  element?: string;
  mount?: (host: HTMLElement, ctx: SectionCtx) => void | (() => void);
  /** `host: true` = the EMBEDDING SHELL renders this section itself, keyed by
   *  `id`. For a React host that owns its own screens, requiring a custom
   *  element or an imperative mount would mean wrapping a React tree in a
   *  fake mount just to satisfy the contract. A section can instead declare
   *  that its renderer lives in the host. A generic shell can't render these
   *  and should say so loudly rather than paint an empty pane. */
  host?: true;
}

/** Plain union, NOT closed by a `never`-exhaustive host convention (see the
 *  spec's forward-compat switch convention). Adding a built-in kind later is
 *  an ADDITIVE change here. */
export type Section = PagesSection | MediaSection | SettingsSection | CollectionSection | CustomSection;
export type SectionKind = Section["kind"];

/**
 * The ONE context object every section renderer (built-in or custom) reads.
 * GROWTH RULE (binding): fields are added, never renamed/removed; a field's
 * type only widens. Removal requires a SECTION_API_VERSION major bump.
 */
export interface SectionCtx {
  readonly apiVersion: typeof SECTION_API_VERSION;
  readonly config: {
    /** Server-only handles, hence optional: every element that reads this ctx
     *  runs in the browser, so a host assembling the ctx client-side (the
     *  normal case in a React-Server-Components app, since a slice registry of
     *  components and an fs-backed adapter can't cross that boundary) simply
     *  omits them. Nothing in the shell reads either one client-side; they're
     *  here for a section renderer that does have server reach. */
    readonly registry?: Record<string, ComponentType<unknown>>;
    readonly adapter?: ContentAdapter;
    /** `list`/`delete` only: the two a browser can call. Uploads go through
     *  the host's upload route (`MediaSectionProps.uploadPath`), never this
     *  handle, so a full server-side `MediaAdapter` satisfies this and a
     *  client-side facade of two server actions does too. */
    readonly mediaAdapter?: Pick<MediaAdapter, "list" | "delete">;
  };
  /** Pages-section actions: the existing PageActions, unchanged shape. */
  readonly actions: PageActions;
  /** One PageActions per declared collection, keyed by section id. */
  readonly collections: Record<string, PageActions>;
  /** Live read/write for runtime SiteSettings (brand/SEO/theme). */
  readonly settings: SettingsStore;
  /** Read-only settings snapshot for chrome (brand logo in the nav, etc.). */
  readonly settingsSnapshot: SiteSettings;
  readonly media?: FieldFormMedia;
  readonly messages?: Partial<Messages>;
  readonly locale: string;
  readonly locales: string[];
  readonly defaultLocale: string;
  /** Navigate to another section (full navigation to `/editor/<id>`). */
  navigate(sectionId: string): void;
  /** Contribute a top-bar right-slot action (e.g. collection "+ New").
   *  Optional; a section that never calls it puts nothing there. Returns an
   *  unregister fn; call with null to clear. */
  setTopBarAction(action: { label: string; onClick: () => void } | null): void;
  /** Feature-detection over version-sniffing: custom sections check
   *  `ctx.capabilities.has("collections.v1")` rather than branching on
   *  apiVersion. Strings are only ever added, never removed. */
  readonly capabilities: ReadonlySet<string>;
}

/** Resolved section the shell renders, every default filled. Internal. */
export interface ResolvedSection {
  raw: Section;
  id: string;
  label: string;
  kind: SectionKind;
  group: string;
  icon?: unknown;
}

export const DEFAULT_SECTIONS: Section[] = [
  { kind: "pages", label: "Pages", group: "content" },
  { kind: "media", label: "Media", group: "content" },
  { kind: "settings", label: "Settings", group: "other" },
];

/** Back-compat resolver, same shape/spirit as resolveI18n(). Omitted or empty
 *  sections → DEFAULT_SECTIONS. Also fills ids/defaults and validates loud. */
export function resolveSections(config: { sections?: Section[] }): ResolvedSection[] {
  const src = config.sections?.length ? config.sections : DEFAULT_SECTIONS;
  const seen = new Set<string>();
  return src.map((s) => {
    if (s.kind === "custom") {
      const provided = [!!s.element, !!s.mount, !!s.host].filter(Boolean).length;
      if (provided !== 1)
        throw new Error(
          `typren: custom section "${s.label}" needs exactly one of element/mount/host (got ${provided})`
        );
    }
    const id = s.id ?? (s.kind === "collection" || s.kind === "custom" ? slug(s.label) : s.kind);
    if (seen.has(id)) throw new Error(`typren: duplicate section id "${id}"`);
    seen.add(id);
    return { raw: s, id, label: s.label, kind: s.kind, group: s.group ?? defaultGroup(s.kind), icon: s.icon };
  });
}

function defaultGroup(k: SectionKind): string {
  return k === "settings" ? "other" : "content";
}
function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
