import { randomUUID } from "node:crypto";
import { ActionRefusedError } from "./actions";
import { libraryFolderError } from "./names";
import { resolveAuth, type AuthAction } from "./auth-adapter";
import { commitOrRestore } from "./git";
import { privateContentAdapter } from "./settings";
import type { CmsConfig, Slice } from "./types";

/** One slice saved to the Sections library (the page editor's "Save to
 *  Sections"): a copy of its props, not a link, so inserting it later pastes
 *  that copy and editing a page never changes the library. */
export type SavedSlice = { id: string; name: string; savedAt: string; slice: Slice; folder?: string };

/** `update`'s outcome: the section as saved, or why it wasn't. "conflict"
 *  means it changed since `baseSavedAt`; "missing" that it was deleted. */
export type LibraryUpdateResult = { ok: true; saved: SavedSlice } | { ok: false; code: "conflict" | "missing" };

/** The Sections library: list, save, update and delete saved slices. */
export interface SliceLibrary {
  list(): Promise<SavedSlice[]>;
  save(name: string, slice: Slice): Promise<SavedSlice>;
  /** Replaces a saved section's slice (and its name, when given), only while
   *  its `savedAt` still equals `baseSavedAt` (the version the caller edited). */
  update(id: string, slice: Slice, baseSavedAt: string, name?: string): Promise<LibraryUpdateResult>;
  remove(id: string): Promise<void>;
  /** Moves a section into `folder` ("" is the top level), checked against
   *  `baseSavedAt` when given. Optional so a host's own library type-checks. */
  move?(id: string, folder: string, baseSavedAt?: string): Promise<LibraryUpdateResult>;
  folders?: LibraryFolders;
  /** Page templates, kept in the same doc. Optional so a host's own
   *  `SliceLibrary` still type-checks; the editor hides them without it. */
  templates?: PageTemplateLibrary;
}

/** A page template: a named, ordered group of sections a new page can start
 *  from. Like a saved section, a copy: a page made from it never changes it. */
export type PageTemplate = { id: string; name: string; savedAt: string; slices: Slice[]; folder?: string };

/** `PageTemplateLibrary.update`'s outcome, read as `LibraryUpdateResult`'s. */
export type TemplateUpdateResult = { ok: true; saved: PageTemplate } | { ok: false; code: "conflict" | "missing" };

/** Page templates: list, save, update and delete. */
export interface PageTemplateLibrary {
  list(): Promise<PageTemplate[]>;
  save(name: string, slices: Slice[]): Promise<PageTemplate>;
  /** Replaces a template's sections (and its name, when given), only while
   *  its `savedAt` still equals `baseSavedAt`. */
  update(id: string, slices: Slice[], baseSavedAt: string, name?: string): Promise<TemplateUpdateResult>;
  remove(id: string): Promise<void>;
  /** As `SliceLibrary.move`. */
  move?(id: string, folder: string, baseSavedAt?: string): Promise<TemplateUpdateResult>;
  folders?: LibraryFolders;
}

/** A library's folders: "/"-joined paths, kept even while empty. */
export interface LibraryFolders {
  list(): Promise<string[]>;
  /** Creates `folder` and any missing parents. */
  create(folder: string): Promise<void>;
  /** Renames or moves `folder`, its subfolders and every entry in them. */
  rename(folder: string, to: string): Promise<void>;
  /** Refuses a folder that holds entries or subfolders. */
  delete(folder: string): Promise<void>;
}

/** `createSliceLibrary`'s library: every optional part present. */
export type FolderedLibrary = Required<Omit<SliceLibrary, "templates">> & { templates: Required<PageTemplateLibrary> };

const LIBRARY_SLUG = "library";

const checkSlice = (slice: Slice) => {
  if (!slice || typeof slice.slice !== "string" || !slice.slice) throw new Error("typren: a saved section needs a slice");
};
const checkSlices = (slices: Slice[]) => {
  if (!Array.isArray(slices) || slices.some((s) => !s || typeof s.slice !== "string" || !s.slice))
    throw new Error("typren: a page template needs a list of slices");
};

type LibraryDoc = { saved: SavedSlice[]; templates: PageTemplate[]; savedFolders: string[]; templateFolders: string[] };
const parentOf = (f: string) => f.slice(0, Math.max(0, f.lastIndexOf("/")));
const within = (f: string | undefined, root: string) => !!f && (f === root || f.startsWith(`${root}/`));
const checkFolder = (folder: string) => {
  const error = libraryFolderError(folder);
  if (error) throw new ActionRefusedError(`typren: folder "${folder}": ${error}`);
};

/**
 * The library is one reserved-slug doc in the private content adapter
 * settings already use (`.typren/library.md` beside a markdown Pages dir), its
 * sections under `saved` and its page templates under `templates` in the
 * front matter. No new adapter method: any
 * adapter that can hold the settings doc holds this one too.
 *
 * Writes are gated as "saveDraft": the library never reaches the live site.
 * With `config.git` and a file-backed doc, every write is committed, the way
 * a page Save is: a detached HEAD refuses it before anything is written, and
 * a failed commit puts the doc back.
 */
export function createSliceLibrary(config: CmsConfig): FolderedLibrary {
  const adapter = privateContentAdapter(config);
  const auth = resolveAuth(config);
  const file = "pageFile" in adapter ? (adapter.pageFile as (slug: string) => string)(LIBRARY_SLUG) : undefined;
  const git = file ? config.git : undefined;
  const guard = async (action: AuthAction) => {
    if (!(await auth.authorize({ action, siteId: config.siteId, accountId: config.accountId })))
      throw new Error("typren: unauthorized");
  };
  const readDoc = async (): Promise<LibraryDoc> => {
    if (!(await adapter.exists(LIBRARY_SLUG))) return { saved: [], templates: [], savedFolders: [], templateFolders: [] };
    const { saved, templates, savedFolders, templateFolders } = adapter.parse(await adapter.readRaw(LIBRARY_SLUG)).meta;
    const paths = (v: unknown) => (Array.isArray(v) ? v.filter((f): f is string => typeof f === "string" && !libraryFolderError(f)) : []);
    return {
      saved: Array.isArray(saved) ? (saved as SavedSlice[]) : [],
      templates: Array.isArray(templates) ? (templates as PageTemplate[]) : [],
      savedFolders: paths(savedFolders),
      templateFolders: paths(templateFolders),
    };
  };
  const read = async () => (await readDoc()).saved;
  // ponytail: read-modify-write of the whole doc, so two writes racing on
  // different entries can drop one (an edit to the same entry is caught by
  // `update`'s savedAt check). Compare the doc's version on write if several
  // editors ever share one library.
  const writeDoc = async (doc: LibraryDoc, message: string) => {
    const before = (await adapter.exists(LIBRARY_SLUG)) ? await adapter.readRaw(LIBRARY_SLUG) : null;
    // Empty lists stay out, so a doc without templates or folders keeps its
    // old shape and older readers see no change.
    const meta = Object.fromEntries(Object.entries(doc).filter(([k, v]) => k === "saved" || (v as unknown[]).length));
    const write = () => adapter.writeRaw(LIBRARY_SLUG, adapter.serialize({ meta, slices: [], body: "" }));
    if (!git) return write();
    const restore = () => (before === null ? adapter.deletePublished(LIBRARY_SLUG) : adapter.writeRaw(LIBRARY_SLUG, before));
    await commitOrRestore(git, [file!], message, restore, write);
  };
  const write = async (saved: SavedSlice[], message: string) => writeDoc({ ...(await readDoc()), saved }, message);
  const writeTemplates = async (templates: PageTemplate[], message: string) =>
    writeDoc({ ...(await readDoc()), templates }, message);
  const readTemplates = async () => (await readDoc()).templates;
  const now = () => new Date().toISOString();

  /**
   * Folders for one list in the doc. A folder is a path in the doc's folder
   * list (the doc's version of the marker files pages keep for empty
   * folders) and an entry's `folder` names one. Moves and folder changes
   * leave `savedAt` alone: it versions an entry's content, which they keep.
   */
  const folderOps = <E extends { id: string; name: string; savedAt: string; folder?: string }>(
    entriesKey: "saved" | "templates",
    foldersKey: "savedFolders" | "templateFolders",
    noun: string
  ) => {
    const get = async () => {
      const doc = await readDoc();
      return { doc, entries: doc[entriesKey] as unknown as E[], folders: doc[foldersKey] };
    };
    const put = (doc: LibraryDoc, entries: E[], folders: string[], message: string) =>
      writeDoc({ ...doc, [entriesKey]: entries, [foldersKey]: [...new Set(folders)].sort() }, message);
    const withParents = (f: string): string[] => (f ? [...withParents(parentOf(f)), f] : []);
    const folders: LibraryFolders = {
      async list() {
        await guard("read");
        return (await get()).folders;
      },
      async create(folder) {
        await guard("saveDraft");
        checkFolder(folder);
        const { doc, entries, folders: all } = await get();
        if (all.includes(folder)) return;
        await put(doc, entries, [...all, ...withParents(folder)], `content: create ${noun} folder ${folder}`);
      },
      async rename(folder, to) {
        await guard("saveDraft");
        checkFolder(folder);
        checkFolder(to);
        const { doc, entries, folders: all } = await get();
        if (!all.includes(folder)) throw new ActionRefusedError(`typren: no ${noun} folder "${folder}"`);
        if (within(to, folder)) throw new ActionRefusedError(`typren: can't move "${folder}" into itself`);
        if (all.includes(to)) throw new ActionRefusedError(`typren: ${noun} folder "${to}" already exists`);
        const swap = (f: string) => (within(f, folder) ? to + f.slice(folder.length) : f);
        await put(
          doc,
          entries.map((e) => (within(e.folder, folder) ? { ...e, folder: swap(e.folder!) } : e)),
          [...all.map(swap), ...withParents(parentOf(to))],
          `content: rename ${noun} folder ${folder} to ${to}`
        );
      },
      async delete(folder) {
        await guard("saveDraft");
        checkFolder(folder);
        const { doc, entries, folders: all } = await get();
        if (!all.includes(folder)) return;
        if (entries.some((e) => within(e.folder, folder)) || all.some((f) => f !== folder && within(f, folder)))
          throw new ActionRefusedError(`typren: ${noun} folder "${folder}" is not empty`);
        await put(doc, entries, all.filter((f) => f !== folder), `content: delete ${noun} folder ${folder}`);
      },
    };
    const move = async (id: string, folder: string, baseSavedAt?: string): Promise<{ ok: true; saved: E } | { ok: false; code: "conflict" | "missing" }> => {
      await guard("saveDraft");
      if (folder) checkFolder(folder);
      const { doc, entries, folders: all } = await get();
      const at = entries.findIndex((e) => e.id === id);
      if (at === -1) return { ok: false, code: "missing" };
      if (baseSavedAt !== undefined && entries[at]!.savedAt !== baseSavedAt) return { ok: false, code: "conflict" };
      if (folder && !all.includes(folder)) throw new ActionRefusedError(`typren: no ${noun} folder "${folder}"`);
      const saved: E = { ...entries[at]!, folder };
      if (!folder) delete saved.folder;
      await put(
        doc,
        entries.map((e, i) => (i === at ? saved : e)),
        all,
        `content: move ${noun} ${saved.name} to ${folder || "the top level"}`
      );
      return { ok: true, saved };
    };
    return { folders, move };
  };
  const sectionFolders = folderOps<SavedSlice>("saved", "savedFolders", "section");
  const templateFolders = folderOps<PageTemplate>("templates", "templateFolders", "template");

  const templates: Required<PageTemplateLibrary> = {
    ...templateFolders,
    async list() {
      await guard("read");
      return readTemplates();
    },
    async save(name, slices) {
      await guard("saveDraft");
      checkSlices(slices);
      const entry: PageTemplate = { id: randomUUID(), name: name.trim() || "Untitled template", savedAt: now(), slices };
      await writeTemplates([...(await readTemplates()), entry], `content: save page template ${entry.name}`);
      return entry;
    },
    async update(id, slices, baseSavedAt, name) {
      await guard("saveDraft");
      checkSlices(slices);
      const all = await readTemplates();
      const at = all.findIndex((t) => t.id === id);
      if (at === -1) return { ok: false, code: "missing" };
      if (all[at]!.savedAt !== baseSavedAt) return { ok: false, code: "conflict" };
      const saved = { ...all[at]!, name: name?.trim() || all[at]!.name, slices, savedAt: now() };
      await writeTemplates(
        all.map((t, i) => (i === at ? saved : t)),
        `content: update page template ${saved.name}`
      );
      return { ok: true, saved };
    },
    async remove(id) {
      await guard("saveDraft");
      const all = await readTemplates();
      const gone = all.find((t) => t.id === id);
      if (!gone) return;
      await writeTemplates(
        all.filter((t) => t !== gone),
        `content: delete page template ${gone.name}`
      );
    },
  };

  return {
    templates,
    ...sectionFolders,
    async list() {
      await guard("read");
      return read();
    },
    async save(name, slice) {
      await guard("saveDraft");
      checkSlice(slice);
      const entry: SavedSlice = { id: randomUUID(), name: name.trim() || slice.slice, savedAt: now(), slice };
      await write([...(await read()), entry], `content: save section ${entry.name}`);
      return entry;
    },
    async update(id, slice, baseSavedAt, name) {
      await guard("saveDraft");
      checkSlice(slice);
      const all = await read();
      const at = all.findIndex((s) => s.id === id);
      if (at === -1) return { ok: false, code: "missing" };
      if (all[at]!.savedAt !== baseSavedAt) return { ok: false, code: "conflict" };
      const saved = { ...all[at]!, name: name?.trim() || all[at]!.name, slice, savedAt: now() };
      await write(
        all.map((s, i) => (i === at ? saved : s)),
        `content: update section ${saved.name}`
      );
      return { ok: true, saved };
    },
    async remove(id) {
      await guard("saveDraft");
      const all = await read();
      const gone = all.find((s) => s.id === id);
      if (!gone) return;
      await write(
        all.filter((s) => s !== gone),
        `content: delete section ${gone.name}`
      );
    },
  };
}
