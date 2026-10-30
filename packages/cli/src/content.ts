import fs from "node:fs";
import path from "node:path";
import {
  ActionRefusedError,
  GitError,
  SITE_SLUG,
  STYLE_TOKENS,
  createLocalSiteConfig,
  createMarkdownAdapter,
  createSettingsStore,
  createSliceLibrary,
  makeActions,
  readMenu,
  sanitizeStyle,
  slugError,
  slugify,
  type AuthAdapter,
  type FolderedLibrary,
  type PageContent,
  type SaveResult,
  type SiteSettingsRuntime,
  type Slice,
} from "@typren/core";
import { buildStudioManifest, resolveSite } from "./studio";

/**
 * Allows everything. Whoever runs the CLI already owns the site's files, so
 * the operating system's permissions are the boundary; there is no session to
 * check. Lives here and is never exported from core: a server must never be
 * handed an adapter that says yes. Slug, locale, media-id, nav-href and style
 * validation still runs in the adapters and stores, not in auth.
 */
export const cliOwnerAuth: AuthAdapter = { authorize: async () => true };

/** A failure with the exit code and `--json` code it reports. Exit 2 is a
 *  version conflict, so a script can retry after re-reading. */
class Fail extends Error {
  constructor(
    message: string,
    readonly code = "error",
    readonly exit = 1,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export type ContentIO = {
  cwd: string;
  stdin: () => Promise<string>;
  log: (text: string) => void;
  error: (text: string) => void;
};

type Flags = Record<string, string | true>;

/** `--flag value`, `--flag=value` and the `booleans` (no value); everything
 *  else is positional, `-` (stdin) included. Unknown flags are refused, so a
 *  typo can't silently drop `--base-version`. */
export function parseFlags(args: string[], allowed: { booleans?: string[]; values?: string[] }): { pos: string[]; flags: Flags } {
  const booleans = new Set(["json", ...(allowed.booleans ?? [])]);
  const values = new Set(["cwd", "locale", ...(allowed.values ?? [])]);
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (booleans.has(name)) flags[name] = true;
    else if (values.has(name)) {
      const value = eq === -1 ? args[++i] : a.slice(eq + 1);
      if (value === undefined) throw new Fail(`--${name} needs a value`, "usage");
      flags[name] = value;
    } else throw new Fail(`unknown flag --${name}`, "usage");
  }
  return { pos, flags };
}

type Out = { data: Record<string, unknown>; text: string };
type Ctx = {
  site: Awaited<ReturnType<typeof makeCtx>>;
  pos: string[];
  flags: Flags;
  locale?: string;
  io: ContentIO;
};

async function makeCtx(cwd: string) {
  const site = resolveSite(cwd);
  if ("error" in site) throw new Fail(site.error, "site");
  const config = createLocalSiteConfig(site, { auth: cliOwnerAuth });
  const actions = makeActions(config);
  const settings = createSettingsStore(config);
  const library = createSliceLibrary(config);
  // The settings doc's draft, which the store itself has no reader for.
  const settingsDraft = createMarkdownAdapter({
    contentDir: path.join(path.dirname(site.contentDir), ".typren"),
    locales: config.adapter.locales,
    defaultLocale: config.adapter.defaultLocale,
  });
  return { cwd, localSite: site, config, actions, settings, library, settingsDraft };
}

const str = (flags: Flags, name: string) => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);
const need = (pos: string[], n: number, usage: string) => {
  if (pos.length < n) throw new Fail(`usage: typren ${usage}`, "usage");
  return pos;
};

async function readInput(c: Ctx, file: string | undefined): Promise<{ raw: string; name: string }> {
  if (!file) throw new Fail("--file is required (a path, or - for stdin)", "usage");
  if (file === "-") return { raw: await c.io.stdin(), name: "-" };
  try {
    return { raw: fs.readFileSync(path.resolve(c.io.cwd, file), "utf8"), name: file };
  } catch {
    throw new Fail(`can't read ${file}`, "input");
  }
}

async function readJson(c: Ctx, file: string | undefined): Promise<unknown> {
  const { raw, name } = await readInput(c, file);
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Fail(`${name} is not valid JSON: ${(e as Error).message}`, "input");
  }
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

async function readSlice(c: Ctx, file: string | undefined): Promise<Slice> {
  const slice = await readJson(c, file);
  if (!isObject(slice) || typeof slice.slice !== "string" || !slice.slice)
    throw new Fail('a slice is a JSON object with a "slice" name, like {"slice":"hero","heading":"Hi"}', "input");
  return slice as Slice;
}

async function readSlices(c: Ctx, file: string | undefined): Promise<Slice[]> {
  const slices = await readJson(c, file);
  if (!Array.isArray(slices) || slices.some((s) => !isObject(s) || typeof s.slice !== "string" || !s.slice))
    throw new Fail('a list of slices is a JSON array of objects that each have a "slice" name', "input");
  return slices as Slice[];
}

/** A page from `.json` (`{meta, slices?, body?}`) or `.md` (front matter, the
 *  adapter's own parse); `-` is sniffed, JSON when it opens with `{`. */
async function readPageFile(c: Ctx, file: string | undefined): Promise<PageContent> {
  const { raw, name } = await readInput(c, file);
  const asJson = name.endsWith(".json") || (name === "-" && raw.trimStart().startsWith("{"));
  if (!asJson && !name.endsWith(".md") && name !== "-") throw new Fail("--file must be a .json or .md file", "input");
  if (!asJson) return c.site.config.adapter.parse(raw);
  let page: unknown;
  try {
    page = JSON.parse(raw);
  } catch (e) {
    throw new Fail(`${name} is not valid JSON: ${(e as Error).message}`, "input");
  }
  if (!isObject(page) || !isObject(page.meta)) throw new Fail('a page is a JSON object with a "meta" object', "input");
  if (page.slices !== undefined && !Array.isArray(page.slices)) throw new Fail("a page's slices must be a list", "input");
  return {
    meta: page.meta,
    slices: (page.slices ?? []) as Slice[],
    body: typeof page.body === "string" ? page.body : "",
  };
}

/** Each slice over its starter props from the site's slices/defaults.ts
 *  (which only the manifest loads), as the studio inserts it. */
async function withStarterProps(c: Ctx, slices: Slice[]): Promise<Slice[]> {
  const manifest = await buildStudioManifest(c.io.cwd, "http://127.0.0.1");
  if ("error" in manifest) throw new Fail(manifest.error, "site");
  return slices.map((given) => {
    const defaults = manifest.defaults[given.slice];
    if (!defaults) throw new Fail(`unknown slice "${given.slice}" (known: ${Object.keys(manifest.defaults).join(", ")})`, "invalid");
    return { ...defaults, ...given } as Slice;
  });
}

function checkSlug(slug: string) {
  for (const segment of slug.split("/")) {
    const problem = slugError(segment, []);
    if (problem) throw new Fail(`slug "${slug}": ${problem}`, "invalid");
  }
}

/** A version-checked write's result as output, or the conflict as exit 2,
 *  naming the version the caller read (`base`) and the current one. */
function saved(r: SaveResult, slug: string, text: string, base: string | undefined): Out {
  if (!r.ok)
    throw new Fail(
      `"${slug}" changed since version ${base ?? "(unknown)"}; it is now ${r.currentVersion ?? "(none)"}. Read it again and retry.`,
      "conflict",
      2,
      { currentVersion: r.currentVersion }
    );
  return { data: { slug, version: r.version }, text };
}

const baseOf = (c: Ctx) => str(c.flags, "base-version");

// --- page ---

const page = {
  async list(c: Ctx): Promise<Out> {
    const { actions } = c.site;
    const [pages, folders] = await Promise.all([actions.listPages(c.locale), actions.listPageFolders(c.locale)]);
    const rows = pages.map((p) => `${p.slug}\t${p.title}${p.hasDraft ? "\t(draft)" : ""}`);
    return { data: { pages, folders }, text: [...rows, ...folders.map((f) => `${f}/\t(folder)`)].join("\n") || "no pages" };
  },
  async get(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page get <slug>");
    const opened = await c.site.actions.getPage(slug!, c.locale);
    if (!opened) throw new Fail(`page "${slug}" does not exist`, "not-found");
    const { page, version, hasDraft } = opened;
    const lines = [`${slug}: ${String(page.meta.title ?? "")}${hasDraft ? " (draft)" : ""}`, `version ${version ?? "(none)"}`];
    lines.push(...page.slices.map((s, i) => `  ${i}. ${s.slice}`));
    return { data: { slug, version, hasDraft, page }, text: lines.join("\n") };
  },
  async create(c: Ctx): Promise<Out> {
    const [title] = need(c.pos, 1, "page create <title> [--slug a/b] [--template <id>] [--sections <file>] [--folder] [--draft]");
    const { actions, library } = c.site;
    const slug = str(c.flags, "slug") ?? slugify(title!);
    if (str(c.flags, "slug")) checkSlug(slug);
    if (c.flags.folder) {
      await actions.createPageFolder(slug, c.locale);
      return { data: { folder: slug }, text: `created folder ${slug}` };
    }
    let slices: Slice[] = [];
    const template = str(c.flags, "template");
    if (template) {
      const found = (await library.templates.list()).find((t) => t.id === template);
      if (!found) throw new Fail(`no page template "${template}"`, "not-found");
      slices = found.slices;
    }
    if (str(c.flags, "sections")) slices = await withStarterProps(c, await readSlices(c, str(c.flags, "sections")));
    // With sections the page is made as a draft, so a Save publishes it whole.
    const made = slices.length
      ? await actions.createPageFrom(title!, slug, slices, c.locale)
      : await actions.createPage(title!, c.locale, { slug, draft: Boolean(c.flags.draft) });
    const draft = slices.length > 0 || Boolean(c.flags.draft);
    return { data: { slug: made, draft }, text: `created ${made}${draft ? " (draft; typren save publishes it)" : ""}` };
  },
  async save(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page save <slug> --file <f> [--base-version <v>]");
    const content = await readPageFile(c, str(c.flags, "file"));
    return saved(await c.site.actions.saveDraft(slug!, content, baseOf(c), c.locale), slug!, `saved draft of ${slug}`, baseOf(c));
  },
  async discard(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page discard <slug>");
    await c.site.actions.discardDraft(slug!, c.locale);
    return { data: { slug }, text: `discarded the draft of ${slug}` };
  },
  async publish(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page publish <slug> [--base-version <v>]");
    return saved(await c.site.actions.publish(slug!, baseOf(c), c.locale), slug!, `published ${slug}`, baseOf(c));
  },
  async delete(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page delete <slug> [--folder]");
    const { actions } = c.site;
    if (c.flags.folder) {
      await actions.deletePageFolder(slug!, c.locale);
      return { data: { folder: slug }, text: `deleted folder ${slug}` };
    }
    if (!(await actions.getPage(slug!))) {
      const pages = await actions.listPages();
      if ((await actions.listPageFolders()).includes(slug!) || pages.some((p) => p.slug.startsWith(`${slug}/`)))
        throw new Fail(`"${slug}" is a folder, not a page. Delete an empty folder with --folder.`, "invalid");
      throw new Fail(`page "${slug}" does not exist`, "not-found");
    }
    await actions.deletePage(slug!);
    return { data: { slug }, text: `deleted ${slug}` };
  },
  async duplicate(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page duplicate <slug>");
    const copy = await c.site.actions.duplicatePage(slug!, c.locale);
    return { data: { slug: copy, from: slug }, text: `duplicated ${slug} as ${copy}` };
  },
  async rename(c: Ctx): Promise<Out> {
    const [slug, to] = need(c.pos, 2, "page rename <slug> <new-slug>");
    checkSlug(to!);
    const r = await c.site.actions.renamePage(slug!, to!);
    if (!r.ok) throw new Fail(`"${to}" already exists`, "conflict", 2);
    return { data: { slug: r.slug, from: slug }, text: `renamed ${slug} to ${r.slug}` };
  },
  async set(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page set <slug> [--title t] [--nav|--no-nav] [--noindex|--no-noindex] [--description d]");
    const { flags } = c;
    const patch = {
      title: str(flags, "title"),
      description: str(flags, "description"),
      nav: flags.nav ? true : flags["no-nav"] ? false : undefined,
      noindex: flags.noindex ? true : flags["no-noindex"] ? false : undefined,
    };
    if (Object.values(patch).every((v) => v === undefined)) throw new Fail("nothing to change: pass --title, --description, --nav or --noindex", "usage");
    return saved(await c.site.actions.updatePageMeta(slug!, patch, baseOf(c), c.locale), slug!, `updated ${slug}`, baseOf(c));
  },
  async "add-section"(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page add-section <slug> --file slice.json [--at n]");
    const given = await readSlice(c, str(c.flags, "file"));
    const at = str(c.flags, "at");
    if (at !== undefined && !/^\d+$/.test(at)) throw new Fail("--at must be a position like 0 or 2", "usage");
    const [slice] = await withStarterProps(c, [given]);
    return saved(
      await c.site.actions.insertSection(slug!, slice, at === undefined ? "end" : Number(at), baseOf(c), c.locale),
      slug!,
      `added ${slice.slice} to ${slug}`,
      baseOf(c)
    );
  },
  async translate(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page translate <slug> --to <locale>");
    const to = str(c.flags, "to");
    if (!to) throw new Fail("--to <locale> is required", "usage");
    await c.site.actions.createTranslation(slug!, to);
    return { data: { slug, locale: to }, text: `created a ${to} draft of ${slug}` };
  },
  async untranslate(c: Ctx): Promise<Out> {
    const [slug] = need(c.pos, 1, "page untranslate <slug> --locale <locale>");
    if (!c.locale) throw new Fail("--locale <locale> is required", "usage");
    await c.site.actions.deleteTranslation(slug!, c.locale);
    return { data: { slug, locale: c.locale }, text: `deleted the ${c.locale} translation of ${slug}` };
  },
};

// --- template and section: the saved-slice library ---

/** A library entry's update result as output, or its conflict as exit 2. */
function updated(r: { ok: true } | { ok: false; code: "conflict" | "missing" }, id: string, data: Record<string, unknown>, text: string): Out {
  if (r.ok) return { data, text };
  if (r.code === "conflict") throw new Fail(`"${id}" changed since it was read. Read it again and retry.`, "conflict", 2);
  throw new Fail(`no entry "${id}"`, "missing");
}

/** `move` and `folder` for `template` and `section`, over either list. */
function libraryFolderVerbs(noun: "template" | "section", lib: (c: Ctx) => Pick<FolderedLibrary["templates"], "folders"> & {
  move(id: string, folder: string, baseSavedAt?: string): Promise<{ ok: true; saved: unknown } | { ok: false; code: "conflict" | "missing" }>;
}) {
  return {
    async move(c: Ctx): Promise<Out> {
      const [id, folder] = need(c.pos, 2, `${noun} move <id> <folder> [--base-saved-at <t>]`);
      const to = folder === "/" ? "" : folder!;
      const r = await lib(c).move(id!, to, str(c.flags, "base-saved-at"));
      return updated(r, id!, { [noun]: r.ok ? r.saved : undefined }, `moved ${noun} ${id} to ${to || "/"}`);
    },
    async folder(c: Ctx): Promise<Out> {
      const [verb, folder, to] = need(c.pos, 1, `${noun} folder list | create|delete <folder> | rename <folder> <to>`);
      const { folders } = lib(c);
      if (verb === "list") {
        const all = await folders.list();
        return { data: { folders: all }, text: all.join("\n") || "no folders" };
      }
      if (!folder) throw new Fail(`usage: typren ${noun} folder create|delete|rename <folder> [<to>]`, "usage");
      if (verb === "create") await folders.create(folder);
      else if (verb === "delete") await folders.delete(folder);
      else if (verb === "rename") await folders.rename(folder, need(c.pos, 3, `${noun} folder rename <folder> <to>`)[2]!);
      else throw new Fail(`unknown ${noun} folder command "${verb}"`, "usage");
      return { data: { folder, ...(to ? { to } : {}) }, text: `${verb}d ${noun} folder ${folder}${to ? ` to ${to}` : ""}` };
    },
  };
}

const template = {
  ...libraryFolderVerbs("template", (c) => c.site.library.templates),
  async list(c: Ctx): Promise<Out> {
    const templates = await c.site.library.templates.list();
    return { data: { templates }, text: templates.map((t) => `${t.id}\t${t.name}\t${t.slices.length} sections\t${t.folder ?? "/"}`).join("\n") || "no templates" };
  },
  async save(c: Ctx): Promise<Out> {
    const [name] = need(c.pos, 1, "template save <name> --file slices.json");
    const saved = await c.site.library.templates.save(name!, await readSlices(c, str(c.flags, "file")));
    return { data: { template: saved }, text: `saved template ${saved.name} (${saved.id})` };
  },
  async update(c: Ctx): Promise<Out> {
    const [id] = need(c.pos, 1, "template update <id> --file slices.json [--base-saved-at <t>] [--name n]");
    const slices = await readSlices(c, str(c.flags, "file"));
    const base = str(c.flags, "base-saved-at") ?? (await c.site.library.templates.list()).find((t) => t.id === id)?.savedAt;
    const r = await c.site.library.templates.update(id!, slices, base ?? "", str(c.flags, "name"));
    return updated(r, id!, { template: r.ok ? r.saved : undefined }, `updated template ${id}`);
  },
  async delete(c: Ctx): Promise<Out> {
    const [id] = need(c.pos, 1, "template delete <id>");
    await c.site.library.templates.remove(id!);
    return { data: { id }, text: `deleted template ${id}` };
  },
};

const section = {
  ...libraryFolderVerbs("section", (c) => c.site.library),
  async list(c: Ctx): Promise<Out> {
    const sections = await c.site.library.list();
    return { data: { sections }, text: sections.map((s) => `${s.id}\t${s.name}\t${s.slice.slice}\t${s.folder ?? "/"}`).join("\n") || "no saved sections" };
  },
  async save(c: Ctx): Promise<Out> {
    const [name] = need(c.pos, 1, "section save <name> --file slice.json");
    const saved = await c.site.library.save(name!, await readSlice(c, str(c.flags, "file")));
    return { data: { section: saved }, text: `saved section ${saved.name} (${saved.id})` };
  },
  async update(c: Ctx): Promise<Out> {
    const [id] = need(c.pos, 1, "section update <id> --file slice.json [--base-saved-at <t>] [--name n]");
    const slice = await readSlice(c, str(c.flags, "file"));
    const base = str(c.flags, "base-saved-at") ?? (await c.site.library.list()).find((s) => s.id === id)?.savedAt;
    const r = await c.site.library.update(id!, slice, base ?? "", str(c.flags, "name"));
    return updated(r, id!, { section: r.ok ? r.saved : undefined }, `updated section ${id}`);
  },
  async delete(c: Ctx): Promise<Out> {
    const [id] = need(c.pos, 1, "section delete <id>");
    await c.site.library.remove(id!);
    return { data: { id }, text: `deleted section ${id}` };
  },
};

// --- media ---

const media = {
  async list(c: Ctx): Promise<Out> {
    const assets = await c.site.actions.listMedia();
    const folders = await c.site.actions.listMediaFolders();
    return { data: { assets, folders }, text: [...assets.map((a) => `${a.id}\t${a.url}`), ...folders.map((f) => `${f}/\t(folder)`)].join("\n") || "no media" };
  },
  async usage(c: Ctx): Promise<Out> {
    const usage = await c.site.actions.mediaUsage();
    const lines = Object.entries(usage).map(([url, uses]) => `${url}\t${uses.map((u) => `${u.slug}${u.locale === c.site.config.adapter.defaultLocale ? "" : ` (${u.locale})`} x${u.count}`).join(", ") || "unused"}`);
    return { data: { usage }, text: lines.join("\n") || "no media" };
  },
  async upload(c: Ctx): Promise<Out> {
    const [file] = need(c.pos, 1, "media upload <file> [--folder f]");
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(path.resolve(c.io.cwd, file!));
    } catch {
      throw new Fail(`can't read ${file}`, "input");
    }
    const r = await c.site.actions.uploadMedia({ name: path.basename(file!), buffer }, str(c.flags, "folder"));
    if (!r.ok) throw new Fail(r.error, "upload");
    return { data: { asset: r.asset }, text: `uploaded ${r.asset.id} (${r.asset.url})` };
  },
  async move(c: Ctx): Promise<Out> {
    const [id, folder] = need(c.pos, 2, "media move <id> <folder> [--name n]");
    const asset = await c.site.actions.moveMedia(id!, folder === "/" ? "" : folder!, str(c.flags, "name"));
    return { data: { asset }, text: `moved ${id} to ${asset.url}` };
  },
  async delete(c: Ctx): Promise<Out> {
    const [id] = need(c.pos, 1, "media delete <id> [--force]");
    await c.site.actions.deleteMedia(id!, { force: Boolean(c.flags.force) });
    return { data: { id }, text: `deleted ${id}` };
  },
  async folder(c: Ctx): Promise<Out> {
    const [verb, folder, to] = need(c.pos, 2, "media folder create|delete|rename <folder> [<to>]");
    const { actions } = c.site;
    if (verb === "create") await actions.createMediaFolder(folder!);
    else if (verb === "delete") await actions.deleteMediaFolder(folder!);
    else if (verb === "rename") await actions.renameMediaFolder(folder!, need(c.pos, 3, "media folder rename <folder> <to>")[2]!);
    else throw new Fail(`unknown media folder command "${verb}"`, "usage");
    return { data: { folder, ...(to ? { to } : {}) }, text: `${verb}d folder ${folder}${to ? ` to ${to}` : ""}` };
  },
};

// --- settings, style, nav ---

/** What Settings shows: its draft when there is one, else what is published. */
async function effectiveSettings(c: Ctx): Promise<{ settings: SiteSettingsRuntime; hasDraft: boolean }> {
  const { settingsDraft, settings } = c.site;
  const draft = await settingsDraft.readDraftRaw("settings", c.locale);
  if (draft) return { settings: settingsDraft.parse(draft).meta as unknown as SiteSettingsRuntime, hasDraft: true };
  return { settings: await settings.get(c.locale), hasDraft: false };
}

const parseValue = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const settings = {
  async get(c: Ctx): Promise<Out> {
    const { settings: current, hasDraft } = await effectiveSettings(c);
    const bootstrap = c.site.settings.bootstrap.readBootstrap();
    return { data: { settings: current, bootstrap, hasDraft }, text: JSON.stringify({ ...current, bootstrap }, null, 2) };
  },
  async set(c: Ctx): Promise<Out> {
    const [key, value] = need(c.pos, 2, "settings set <dot.key> <value>");
    const keys = key!.split(".");
    if (!keys.every((k) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(k)) || keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k)))
      throw new Fail(`"${key}" is not a settings key`, "invalid");
    if (keys[0] === "style" || keys[0] === "bootstrap")
      throw new Fail(`use \`typren ${keys[0] === "style" ? "style set" : "settings bootstrap set"}\` for ${keys[0]}`, "usage");
    const next = structuredClone((await effectiveSettings(c)).settings) as unknown as Record<string, unknown>;
    let at = next;
    for (const k of keys.slice(0, -1)) {
      if (at[k] === undefined) at[k] = {};
      if (!isObject(at[k])) throw new Fail(`"${k}" in "${key}" is not an object`, "invalid");
      at = at[k] as Record<string, unknown>;
    }
    at[keys.at(-1)!] = parseValue(value!);
    const r = await c.site.settings.saveDraft(next as unknown as SiteSettingsRuntime, baseOf(c), c.locale);
    return saved(r, "settings", `set ${key} (a draft; typren settings publish ships it)`, baseOf(c));
  },
  async publish(c: Ctx): Promise<Out> {
    return saved(await c.site.settings.publish(baseOf(c), c.locale), "settings", "published settings", baseOf(c));
  },
  async bootstrap(c: Ctx): Promise<Out> {
    const [verb, key, value] = need(c.pos, 3, "settings bootstrap set <key> <value>");
    if (verb !== "set") throw new Fail(`unknown bootstrap command "${verb}"`, "usage");
    let parsed = parseValue(value!);
    if (key === "locales" && typeof parsed === "string") parsed = parsed.split(",").map((l) => l.trim());
    const r = await c.site.settings.writeBootstrap({ [key!]: parsed });
    if (!r.ok) throw new Fail(r.error, "invalid");
    return { data: { key, value: parsed }, text: `set bootstrap ${key}` };
  },
};

const tokenName = (t: string) => (t.startsWith("--") ? t : t.startsWith("typren-") ? `--${t}` : `--typren-${t}`);
function checkToken(t: string): string {
  const name = tokenName(t);
  if (!STYLE_TOKENS.some((k) => k.name === name))
    throw new Fail(`unknown style token "${t}" (known: ${STYLE_TOKENS.map((k) => k.name).join(", ")})`, "invalid");
  return name;
}

const style = {
  async get(c: Ctx): Promise<Out> {
    const { settings: current, hasDraft } = await effectiveSettings(c);
    const tokens = current.style ?? {};
    return { data: { style: tokens, hasDraft }, text: Object.entries(tokens).map(([k, v]) => `${k}: ${v}`).join("\n") || "no style tokens set" };
  },
  async set(c: Ctx): Promise<Out> {
    const [token, value] = need(c.pos, 2, "style set <token> <value>");
    const name = checkToken(token!);
    // sanitizeStyle drops an unsafe value quietly; a command must say so.
    if (sanitizeStyle({ [name]: value! })[name] !== value!.trim()) throw new Fail(`"${value}" is not a safe value for ${name}`, "invalid");
    const current = (await effectiveSettings(c)).settings;
    const next = { ...current, style: { ...current.style, [name]: value!.trim() } };
    return saved(await c.site.settings.saveDraft(next, baseOf(c), c.locale), "settings", `set ${name} (a draft; typren style publish ships it)`, baseOf(c));
  },
  async unset(c: Ctx): Promise<Out> {
    const [token] = need(c.pos, 1, "style unset <token>");
    const name = checkToken(token!);
    const current = (await effectiveSettings(c)).settings;
    const { [name]: _gone, ...rest } = current.style ?? {};
    void _gone;
    return saved(await c.site.settings.saveDraft({ ...current, style: rest }, baseOf(c), c.locale), "settings", `unset ${name}`, baseOf(c));
  },
  publish: settings.publish,
};

const nav = {
  async get(c: Ctx): Promise<Out> {
    const opened = await c.site.actions.getPage(SITE_SLUG, c.locale);
    const menu = opened && readMenu(opened.page.meta);
    if (!opened || !menu) throw new Fail("this site's menu is built in its code, so there is none to read", "not-found");
    return {
      data: { nav: menu.nav, cta: menu.cta ?? null, version: opened.version, hasDraft: opened.hasDraft },
      text: JSON.stringify(menu, null, 2),
    };
  },
  async set(c: Ctx): Promise<Out> {
    const menu = await readJson(c, str(c.flags, "file"));
    if (!isObject(menu) || !Array.isArray(menu.nav)) throw new Fail('a menu is a JSON object with a "nav" list, and optionally a "cta"', "input");
    const opened = await c.site.actions.getPage(SITE_SLUG, c.locale);
    if (!opened) throw new Fail("this site has no site doc to hold a menu", "not-found");
    const meta: Record<string, unknown> = { ...opened.page.meta, nav: menu.nav };
    if (menu.cta === undefined) delete meta.cta;
    else meta.cta = menu.cta;
    // The store runs assertSafeNav on this draft, so an unsafe href is refused there.
    return saved(await c.site.actions.saveDraft(SITE_SLUG, { ...opened.page, meta }, baseOf(c), c.locale), SITE_SLUG, "saved the menu (a draft; typren nav publish ships it)", baseOf(c));
  },
  async publish(c: Ctx): Promise<Out> {
    return saved(await c.site.actions.publish(SITE_SLUG, baseOf(c), c.locale), SITE_SLUG, "published the menu", baseOf(c));
  },
};

// --- git ---

/** Pages with a draft, and the site doc when its menu has one. */
const pending = async (c: Ctx) => [
  ...(await c.site.actions.listPages(c.locale)).filter((p) => p.hasDraft).map((p) => p.slug),
  ...((await c.site.config.adapter.hasDraft(SITE_SLUG, c.locale)) ? [SITE_SLUG] : []),
];

const top = {
  async save(c: Ctx): Promise<Out> {
    const drafted = await pending(c);
    const targets = c.pos.length ? c.pos : drafted;
    const skipped = targets.filter((s) => !drafted.includes(s));
    const slugs = targets.filter((s) => drafted.includes(s));
    for (const slug of slugs) {
      const r = await c.site.actions.commitPage(slug, undefined, undefined, c.locale);
      if (!r.ok) throw new Fail(`"${slug}" changed while saving. Read it again and retry.`, "conflict", 2, { currentVersion: r.currentVersion });
    }
    return { data: { saved: slugs, skipped }, text: slugs.length ? `saved ${slugs.join(", ")}` : "nothing to save" };
  },
  async publish(c: Ctx): Promise<Out> {
    const { actions, config } = c.site;
    if (!config.git) {
      const published = await actions.publishAll(c.locale);
      return { data: { published }, text: published.length ? `published ${published.join(", ")}` : "nothing to publish" };
    }
    const { commits } = await config.git.outgoing();
    const r = await actions.push();
    if (!r.ok) throw new Fail(r.error, "git");
    return { data: { pushed: commits.length }, text: `pushed ${commits.length} commit(s)` };
  },
  async status(c: Ctx): Promise<Out> {
    const { config, settingsDraft } = c.site;
    const drafts = await pending(c);
    const settingsDraftPending = await settingsDraft.hasDraft("settings", c.locale);
    const navDraft = await config.adapter.hasDraft(SITE_SLUG, c.locale);
    const data: Record<string, unknown> = { git: Boolean(config.git), drafts, settingsDraft: settingsDraftPending, navDraft };
    const lines = [`pending drafts: ${drafts.join(", ") || "none"}`];
    if (settingsDraftPending) lines.push("settings has a draft");
    if (navDraft) lines.push("the menu has a draft");
    if (config.git) {
      const out = await config.git.outgoing();
      Object.assign(data, { branch: out.branch, detached: !out.branch, upstream: out.upstream, outgoing: out.commits });
      lines.unshift(
        out.branch ? `branch ${out.branch}${out.upstream ? ` (tracking ${out.upstream})` : " (no upstream)"}` : "detached HEAD: check out a branch to save",
        `outgoing commits: ${out.commits.length}`,
        ...out.commits.map((m) => `  ${m.hash} ${m.subject}`)
      );
    } else lines.unshift("not a git checkout");
    return { data, text: lines.join("\n") };
  },
};

/** What waits to push: pages with a saved draft, then saved (committed)
 *  files the upstream lacks. The studio's Review panel. */
const changes = {
  async list(c: Ctx): Promise<Out> {
    const drafts = await pending(c);
    const items = await c.site.actions.pendingChanges();
    const lines = [...drafts.map((s) => `draft    ${s}`), ...items.map((i) => `${i.change.padEnd(8)} ${i.path}`)];
    return { data: { drafts, changes: items }, text: lines.join("\n") || "nothing waiting to push" };
  },
  /** Each argument is a drafted page's slug or a pending file's path: every
   *  page goes out as one commit of its own. */
  async push(c: Ctx): Promise<Out> {
    const drafts = new Set(await pending(c));
    const slugs = c.pos.filter((p) => drafts.has(p));
    const paths = c.pos.filter((p) => !drafts.has(p));
    const r = await c.site.actions.pushChanges(paths, slugs, c.locale);
    if (!r.ok) throw new Fail(r.error, "git");
    return { data: { pushed: c.pos }, text: `pushed ${c.pos.join(", ")}` };
  },
  /** A page's version history, newest first. */
  async log(c: Ctx): Promise<Out> {
    const [slug] = c.pos;
    if (!slug) throw new Fail("usage: typren changes log <page>", "usage");
    const entries = await c.site.actions.pageHistory(slug, c.locale);
    const text = entries.length ? entries.map((e) => `${e.hash} ${e.date.slice(0, 10)} ${e.author}: ${e.subject}`).join("\n") : "no history yet";
    return { data: { history: entries }, text };
  },
  async discard(c: Ctx): Promise<Out> {
    await c.site.actions.discardChanges(c.pos);
    return { data: { discarded: c.pos }, text: `discarded ${c.pos.join(", ")}` };
  },
};

type Verb = (c: Ctx) => Promise<Out>;
const NOUNS: Record<string, { verbs: Record<string, Verb>; booleans?: string[]; values?: string[]; bare?: boolean }> = {
  page: {
    verbs: page,
    booleans: ["folder", "draft", "nav", "no-nav", "noindex", "no-noindex"],
    values: ["slug", "template", "sections", "file", "base-version", "title", "description", "at", "to"],
  },
  template: { verbs: template, values: ["file", "base-saved-at", "name"] },
  section: { verbs: section, values: ["file", "base-saved-at", "name"] },
  media: { verbs: media, booleans: ["force"], values: ["folder", "name"] },
  settings: { verbs: settings, values: ["base-version"] },
  style: { verbs: style, values: ["base-version"] },
  nav: { verbs: nav, values: ["file", "base-version"] },
  changes: { verbs: changes },
  save: { verbs: { "": top.save }, bare: true },
  publish: { verbs: { "": top.publish }, bare: true },
  status: { verbs: { "": top.status }, bare: true },
};

/** The command words `main` hands to `runContent`. */
export const CONTENT_COMMANDS = Object.keys(NOUNS);

/**
 * Runs one content command (`argv[0]` is its noun) and returns its exit code:
 * 0 done, 1 error, 2 version conflict. Prints `{ ok: true, ... }` or
 * `{ ok: false, code, error }` with `--json`, readable text otherwise.
 * Never prompts.
 */
export async function runContent(argv: string[], io: ContentIO): Promise<number> {
  const [noun = "", ...rest] = argv;
  const spec = NOUNS[noun]!;
  let json = rest.includes("--json");
  try {
    const { pos, flags } = parseFlags(rest, spec);
    json = Boolean(flags.json);
    const cwd = path.resolve(io.cwd, str(flags, "cwd") ?? ".");
    if (!fs.existsSync(cwd)) throw new Fail(`no such directory: ${cwd}`, "site");
    const verb = spec.bare ? "" : (pos.shift() ?? "");
    // `media folder` and `settings bootstrap` carry their own sub-verb in pos.
    const run = Object.hasOwn(spec.verbs, verb) ? spec.verbs[verb] : undefined;
    if (!run) throw new Fail(`usage: typren ${noun} <${Object.keys(spec.verbs).join("|")}>`, "usage");
    const c: Ctx = { site: await makeCtx(cwd), pos, flags, locale: str(flags, "locale"), io: { ...io, cwd } };
    const out = await run(c);
    io.log(json ? JSON.stringify({ ok: true, ...out.data }) : out.text);
    return 0;
  } catch (e) {
    const fail =
      e instanceof Fail
        ? e
        : new Fail(
            (e as Error).message ?? String(e),
            e instanceof GitError ? "git" : e instanceof ActionRefusedError ? "invalid" : "error",
            (e as { code?: string }).code === "conflict" ? 2 : 1
          );
    if (json) io.log(JSON.stringify({ ok: false, code: fail.code, error: fail.message, ...fail.extra }));
    else io.error(`typren ${noun}: ${fail.message}`);
    return fail.exit;
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
