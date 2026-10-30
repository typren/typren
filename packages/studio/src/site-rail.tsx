"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  ChevronDown,
  Database,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  House,
  Image,
  LayoutTemplate,
  Menu,
  Palette,
  Puzzle,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { BUILT_IN_FOLDER, nameError, type MediaAsset, type PageInfo, type ResolvedSection, type SliceLibrary } from "@typren/core";
import { useT } from "./intl";
import { AddButton } from "./primitives/add-button";
import { PanelHeader } from "./primitives/panel-header";
import { Button } from "./primitives/button";
import { useConfirm } from "./primitives/confirm";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./primitives/collapsible";
import { Input } from "./primitives/input";
import { cn } from "./primitives/cn";
import { SelectionList, rowClass } from "./primitives/selection";
import { DROP_RING, folderDrop } from "./primitives/sortable";
import { ASSET_DRAG_TYPE, InlineRename, ItemMenu } from "./asset-browser";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives/popover";
import { usePortal } from "./primitives/portal";
import { PageSettings, type PageSettingsIO } from "./page-settings";
import { folderLabel } from "./library-browser";
import { TEMPLATE_DRAG_TYPE } from "./page-templates";
import { Loading, RowsSkeleton } from "./primitives/skeleton";
import { SECTION_DRAG_TYPE } from "./sections-library";

const GROUP_LABEL: Record<string, string> = {
  website: "Website",
  content: "Content",
  other: "Other",
};

/** Rail groups at level 0: Website first (Pages always belongs to it, whatever
 *  group the config gave it), then every other group in config order. */
export function railGroups(sections: ResolvedSection[]): { id: string; label: string; items: ResolvedSection[] }[] {
  const buckets = new Map<string, ResolvedSection[]>([["website", []]]);
  for (const s of sections) {
    const g = s.kind === "pages" ? "website" : s.group;
    buckets.set(g, [...(buckets.get(g) ?? []), s]);
  }
  return [...buckets]
    .filter(([, items]) => items.length)
    .map(([id, items]) => ({
      id,
      label: GROUP_LABEL[id] ?? id[0].toUpperCase() + id.slice(1),
      items,
    }));
}

/** Level-1 page groups, in rail order. A page that was never published is a
 *  draft whatever its front matter says; then `system`, then `noindex`, then
 *  `nav` decide. In navigation sorts by `navOrder`, pages without one last,
 *  ties in listing order. */
export function groupPages(pages: PageInfo[]): {
  main: PageInfo[];
  other: PageInfo[];
  hidden: PageInfo[];
  system: PageInfo[];
  drafts: PageInfo[];
} {
  const drafts = pages.filter((p) => p.published === false);
  const live = pages.filter((p) => p.published !== false);
  const system = live.filter((p) => p.system);
  const hidden = live.filter((p) => p.noindex && !p.system);
  const rest = live.filter((p) => !p.system && !p.noindex);
  const main = rest.filter((p) => p.nav).sort((a, b) => (a.navOrder ?? Infinity) - (b.navOrder ?? Infinity));
  const other = rest.filter((p) => !p.nav);
  return { main, other, hidden, system, drafts };
}

export type PageNode = { segment: string; path: string; page?: PageInfo; children: PageNode[] };

/** Nests pages by slug segment: `event/1` sits under `event`. A path with no
 *  page of its own in `pages` (a parent that lives in another group, or one of
 *  `folders`) is a folder node. Siblings keep their order of first appearance. */
export function pageTree(pages: PageInfo[], folders: string[] = []): PageNode[] {
  const nodes = new Map<string, PageNode>();
  const root: PageNode[] = [];
  const node = (path: string): PageNode => {
    let n = nodes.get(path);
    if (!n) {
      const cut = path.lastIndexOf("/");
      n = { segment: path.slice(cut + 1), path, children: [] };
      nodes.set(path, n);
      (cut < 0 ? root : node(path.slice(0, cut)).children).push(n);
    }
    return n;
  };
  for (const p of pages) node(p.slug).page = p;
  for (const f of folders) node(f);
  return root;
}

function Group({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <Collapsible defaultOpen className="px-3 pb-4">
      <CollapsibleTrigger className="group/trigger flex w-full cursor-pointer select-none items-center justify-between rounded-[var(--typren-radius-control)] px-3 py-1.5 text-left text-[15px] text-[var(--typren-muted-fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 -rotate-90 transition-transform duration-200 group-data-[panel-open]/trigger:rotate-0 motion-reduce:transition-none" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-1">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Row actions overlay the row's right end, so the row (and its hover and
// selected fill) always spans the rail's full width.
const TRAILING = "absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center";
const TRAILING_ACTION =
  "typren-concentric [--typren-inset:6px] cursor-pointer p-1.5 text-[var(--typren-muted-fg)] opacity-0 transition-[opacity,color] motion-reduce:transition-none hover:text-[var(--typren-destructive)] focus:opacity-100 group-hover/row:opacity-100";
// A page row's end adornment (draft dot, home icon) and its settings button
// share one slot. Hover, focus or an open popover crossfades the adornment
// out and the button in, so the slot's width is reserved once and the title
// never reflows.
const SLOT = "grid h-[26px] min-w-[26px] place-items-center justify-items-end *:col-start-1 *:row-start-1";
const FADE = "transition-opacity duration-150 ease-in-out motion-reduce:transition-none";
const ADORNMENT_OUT = cn(
  FADE,
  "pointer-events-none flex items-center gap-1.5 pr-1 group-hover/row:opacity-0 group-focus-within/row:opacity-0 group-has-data-popup-open/row:opacity-0"
);
const ACTION_IN = cn(
  FADE,
  "typren-concentric [--typren-inset:6px] cursor-pointer p-1.5 text-[var(--typren-muted-fg)] opacity-0 outline-none hover:text-[var(--typren-fg)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-popup-open:opacity-100"
);

const KIND_ICON = { pages: FileText, media: Image, library: LayoutTemplate, settings: Settings, collection: Database };
const CUSTOM_ICON: Record<string, typeof Puzzle> = { navigation: Menu, style: Palette };

/** A section's own icon, else one for its kind (custom sections by id). */
function sectionIcon(s: ResolvedSection): ReactNode {
  // A host hands `icon` over as an already-rendered node, never a component.
  if (s.icon) return s.icon as ReactNode;
  const Icon = s.kind === "custom" ? (CUSTOM_ICON[s.id] ?? Puzzle) : KIND_ICON[s.kind];
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

/** Level 0: the site name and its sections, grouped. */
export function SiteLevel({
  siteName,
  sections,
  activeId,
  onOpen,
}: Readonly<{
  siteName?: string;
  sections: ResolvedSection[];
  activeId?: string;
  onOpen: (s: ResolvedSection) => void;
}>) {
  return (
    <SelectionList>
      {siteName && <PanelHeader title={siteName} />}
      {railGroups(sections).map((g) => (
        <Group key={g.id} label={g.label}>
          {g.items.map((s) => {
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={s.id === activeId ? "page" : undefined}
                  onClick={() => onOpen(s)}
                  className={rowClass(s.id === activeId)}
                >
                  {sectionIcon(s)}
                  <span className="min-w-0 truncate" title={s.label}>
                    {s.label}
                  </span>
                </button>
              </li>
            );
          })}
        </Group>
      ))}
    </SelectionList>
  );
}

/** Level 1: Pages, the home page pinned first, then grouped, each group a
 *  tree of slug segments, with a create wizard and delete. */
export function PagesLevel({
  pages,
  folders = [],
  currentSlug,
  homeSlug,
  onNew,
  onDelete,
  onDeleteFolder,
  onNavigate,
  settingsIO,
}: Readonly<{
  pages: PageInfo[];
  /** Folders kept without pages (see `ContentAdapter.listFolders`). */
  folders?: string[];
  currentSlug?: string | null;
  homeSlug: string;
  /** Opens the new-page wizard (see new-page-wizard.tsx); omit for no "+". */
  onNew?: () => void;
  onDelete: (slug: string) => Promise<void>;
  /** Removes a kept folder; offered only while nothing is under it. */
  onDeleteFolder?: (folder: string) => Promise<void>;
  onNavigate: (slug: string | null) => void;
  /** Loads and saves a page for its settings popover, and renames it. Omit
   *  and the popover offers the status, the slug and delete only. */
  settingsIO?: PageSettingsIO;
}>) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const home = pages.find((p) => p.slug === homeSlug);
  const { main, other, hidden, system, drafts } = groupPages(pages.filter((p) => p !== home));
  const under = (path: string) => [...pages.map((p) => p.slug), ...folders].some((s) => s.startsWith(`${path}/`));
  const siblings = (slug: string) => {
    const parent = slug.slice(0, slug.lastIndexOf("/") + 1);
    return [...pages.map((p) => p.slug), ...folders]
      .filter((s) => s.startsWith(parent) && !s.slice(parent.length).includes("/"))
      .map((s) => s.slice(parent.length));
  };

  const removeFolder = async (folder: string) => {
    if (!onDeleteFolder || !(await confirm({ title: "Delete folder?", description: `Delete the empty folder "${folder}"?`, confirmLabel: "Delete", destructive: true }))) return;
    startTransition(() => onDeleteFolder(folder));
  };

  const remove = async (slug: string) => {
    if (!(await confirm({ title: "Delete page?", description: t("nav.confirmDelete", { slug }), confirmLabel: "Delete", destructive: true }))) return;
    startTransition(async () => {
      await onDelete(slug);
      onNavigate(null);
    });
  };

  const node = (n: PageNode, depth: number): ReactNode => {
    const p = n.page;
    const label = p?.title ?? n.segment;
    const indent = { paddingLeft: `${0.75 + depth}rem` };
    const chevron = (
      <ChevronDown
        className="size-4 shrink-0 -rotate-90 text-[var(--typren-muted-fg)] transition-transform duration-200 group-data-[panel-open]/node:rotate-0 motion-reduce:transition-none"
        aria-hidden
      />
    );
    const row = p ? (
      <div className="group/row relative flex items-center">
        <button
          type="button"
          style={indent}
          aria-current={p.slug === currentSlug ? "page" : undefined}
          onClick={() => onNavigate(p.slug)}
          className={cn(rowClass(p.slug === currentSlug), n.children.length > 0 ? "pr-16" : "pr-10")}
        >
          <span className="min-w-0 flex-1 truncate" title={p.title}>{p.title}</span>
        </button>
        <span className={TRAILING}>
          {n.children.length > 0 && (
            <CollapsibleTrigger
              aria-label={`Pages under ${label}`}
              className="typren-concentric group/node shrink-0 cursor-pointer p-1.5 outline-none [--typren-inset:6px] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]"
            >
              {chevron}
            </CollapsibleTrigger>
          )}
          <span className={SLOT}>
            <span className={ADORNMENT_OUT}>
              {p.hasDraft && p.published !== false && (
                <span role="img" aria-label="Has draft" className="size-1.5 shrink-0 rounded-full bg-[var(--typren-brand)]" title="Has draft" />
              )}
              {p.slug === homeSlug && <House className="size-4 shrink-0" role="img" aria-label="Home page" />}
            </span>
            <PageSettings
              page={p}
              home={p.slug === homeSlug}
              siblings={siblings(p.slug)}
              nested={n.children.length > 0 || under(p.slug)}
              io={settingsIO}
              pending={pending}
              triggerClassName={ACTION_IN}
              onDelete={remove}
              onRenamed={(to) => p.slug === currentSlug && onNavigate(to)}
            />
          </span>
        </span>
      </div>
    ) : (
      <div className="group/row relative flex items-center">
        <CollapsibleTrigger
          style={indent}
          className={cn(
            rowClass(false),
            "group/node",
            onDeleteFolder && folders.includes(n.path) && !under(n.path) && "pr-10"
          )}
        >
          <Folder className="size-4 shrink-0 text-[var(--typren-muted-fg)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={n.segment}>{n.segment}</span>
          {n.children.length > 0 && chevron}
        </CollapsibleTrigger>
        {onDeleteFolder && folders.includes(n.path) && !under(n.path) && (
          <button
            type="button"
            aria-label={`Delete folder ${n.path}`}
            disabled={pending}
            onClick={() => removeFolder(n.path)}
            className={cn(TRAILING_ACTION, "absolute right-1.5 top-1/2 -translate-y-1/2")}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    );
    return (
      <li key={n.path}>
        <Collapsible defaultOpen={!!currentSlug?.startsWith(`${n.path}/`)}>
          {row}
          {n.children.length > 0 && (
            <CollapsibleContent>
              <ul className="space-y-1">{n.children.map((c) => node(c, depth + 1))}</ul>
            </CollapsibleContent>
          )}
        </Collapsible>
      </li>
    );
  };
  const group = (label: string, list: PageInfo[], extra: string[] = []) =>
    list.length + extra.length > 0 && <Group label={label}>{pageTree(list, extra).map((n) => node(n, 0))}</Group>;

  return (
    <SelectionList>
      <PanelHeader title={t("nav.pages")}>
        {onNew && (
          <AddButton label={t("nav.newPage")} aria-haspopup="dialog" disabled={pending} onClick={onNew} />
        )}
      </PanelHeader>
      {home && <ul className="space-y-1 px-3 pb-4">{node({ segment: home.slug, path: home.slug, page: home, children: [] }, 0)}</ul>}
      {group("In navigation", main)}
      {group("Not in navigation", other, folders)}
      {group("Hidden from search", hidden)}
      {group("System Pages", system)}
      {group("Drafts", drafts)}
      {dialog}
    </SelectionList>
  );
}

const parentOf = (f: string) => f.slice(0, Math.max(0, f.lastIndexOf("/")));
const leafOf = (f: string) => f.slice(f.lastIndexOf("/") + 1);

/**
 * A folder tree's rows, shared by Assets and Templates: `""` is the root,
 * labelled `rootLabel`. Rows take items dragged as `dragType`, rename on
 * double-click or from the right-click menu, and offer delete only while
 * `count` is 0. A `fixed` folder (Templates' Built-in) does none of that.
 * Pass `current` as null when another tree holds the selection.
 */
export function FolderRows({
  folders,
  rootLabel,
  current,
  count,
  label = leafOf,
  fixed = [],
  dragType = ASSET_DRAG_TYPE,
  onOpen,
  onRename,
  onDelete,
  onMove,
}: Readonly<{
  /** Every folder path, in tree order, without the root. */
  folders: string[];
  rootLabel: string;
  current: string | null;
  count: (folder: string) => number;
  label?: (folder: string) => string;
  fixed?: string[];
  dragType?: string;
  onOpen: (folder: string) => void;
  onRename?: (folder: string, to: string) => Promise<void>;
  onDelete?: (folder: string) => Promise<void>;
  onMove?: (id: string, folder: string) => void;
}>) {
  const { confirm, dialog } = useConfirm();
  const [over, setOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const siblings = (of: string) => folders.filter((f) => parentOf(f) === of).map(leafOf);
  const inCurrent = (folder: string) => current !== null && (current === folder || current.startsWith(`${folder}/`));
  const rename = (folder: string, next: string | null) => {
    setRenaming(null);
    if (!next || !onRename) return;
    const to = parentOf(folder) ? `${parentOf(folder)}/${next}` : next;
    startTransition(async () => {
      await onRename(folder, to);
      if (inCurrent(folder)) onOpen(to + current!.slice(folder.length));
    });
  };
  const remove = async (folder: string) => {
    if (!onDelete || !(await confirm({ title: "Delete folder?", description: `Delete the empty folder "${label(folder)}"?`, confirmLabel: "Delete", destructive: true }))) return;
    startTransition(async () => {
      await onDelete(folder);
      if (inCurrent(folder)) onOpen(parentOf(folder));
    });
  };

  const row = (folder: string) => {
    const depth = folder ? folder.split("/").length : 0;
    const isFixed = fixed.includes(folder);
    const Icon = folder === current ? FolderOpen : Folder;
    const n = count(folder);
    const canDelete = !!folder && !isFixed && !!onDelete && n === 0;
    const canRename = !!folder && !isFixed && !!onRename;
    // The rename input can't sit inside a button.
    const RowTag = renaming === folder ? "div" : "button";
    const content = (
      <div className="group/row relative flex items-center">
        <RowTag
          type={renaming === folder ? undefined : "button"}
          aria-current={folder === current ? "page" : undefined}
          onClick={() => renaming !== folder && onOpen(folder)}
          onDoubleClick={() => canRename && setRenaming(folder)}
          style={{ paddingLeft: `${0.75 + depth}rem` }}
          className={cn(rowClass(folder === current), over === folder && DROP_RING, canDelete && "pr-10")}
        >
          <Icon className="size-4 shrink-0 text-[var(--typren-muted-fg)]" aria-hidden />
          <InlineRename
            value={folder ? label(folder) : rootLabel}
            editing={renaming === folder}
            validate={(next) => nameError(next, siblings(parentOf(folder)).filter((l) => l !== leafOf(folder)))}
            onDone={(next) => rename(folder, next)}
            className="min-w-0 flex-1 truncate"
          />
          <span className="shrink-0 text-xs font-normal text-[var(--typren-muted-fg)]">{n}</span>
        </RowTag>
        {canDelete && (
          <button
            type="button"
            aria-label={`Delete folder ${folder}`}
            disabled={pending}
            onClick={() => remove(folder)}
            className={cn(TRAILING_ACTION, "absolute right-1.5 top-1/2 -translate-y-1/2")}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    );
    return (
      <li key={folder || "/"} {...(onMove && !isFixed && folderDrop(folder, { onMove, setOver, type: dragType }))}>
        {canRename || canDelete ? (
          <ItemMenu onRename={canRename ? () => setRenaming(folder) : undefined} onDelete={canDelete ? () => remove(folder) : undefined}>
            {content}
          </ItemMenu>
        ) : (
          content
        )}
      </li>
    );
  };
  return (
    <>
      {["", ...folders].map(row)}
      {dialog}
    </>
  );
}

/** The rail's "New folder" field: a name, checked against `siblings` as the
 *  user types, created under `parent` on Enter or Add. */
function NewFolderField({
  parent,
  siblings,
  onCreate,
  onDone,
}: Readonly<{ parent: string; siblings: string[]; onCreate: (folder: string) => Promise<void>; onDone: (folder?: string) => void }>) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const error = name ? nameError(name.trim(), siblings) : null;
  const create = () => {
    const leaf = name.trim();
    if (!leaf || nameError(leaf, siblings)) return;
    const folder = parent ? `${parent}/${leaf}` : leaf;
    startTransition(async () => {
      await onCreate(folder);
      onDone(folder);
    });
  };
  return (
    <div className="flex flex-col gap-1.5 px-6 pb-4">
      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder={parent ? `Folder in ${parent}` : "Folder name"}
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "typren-new-folder-error" : undefined}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
            if (e.key === "Escape") onDone();
          }}
        />
        <Button disabled={pending || !name.trim() || !!error} onClick={create}>
          Add
        </Button>
      </div>
      {error && (
        <p id="typren-new-folder-error" role="alert" className="text-xs text-[var(--typren-destructive)]">
          {error}
        </p>
      )}
    </div>
  );
}

const MENU_ROW =
  "flex h-9 items-center gap-2 typren-concentric cursor-pointer px-2 text-left transition-colors duration-150 hover:bg-[var(--typren-fill-subtle-hover)] motion-reduce:transition-none";

/** Level 1: Assets, as its folder tree. Rows take dropped asset tiles and
 *  rename on double-click or from the right-click menu; a folder offers
 *  delete only while nothing is in it, since the adapter refuses otherwise. */
export function AssetsLevel({
  folders,
  assets,
  current,
  onOpen,
  onCreate,
  onUpload,
  onRename,
  onDelete,
  onMove,
}: Readonly<{
  /** Undefined when the media adapter has no folders: the tree is All Assets alone. */
  folders?: string[];
  assets: MediaAsset[];
  current: string;
  onOpen: (folder: string) => void;
  onCreate?: (folder: string) => Promise<void>;
  /** Uploads into `current`. */
  onUpload: (files: FileList) => void;
  onRename?: (folder: string, to: string) => Promise<void>;
  onDelete?: (folder: string) => Promise<void>;
  onMove?: (id: string, folder: string) => void;
}>) {
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const portal = usePortal();
  const inside = (f: string) => assets.filter((a) => (a.folder ?? "") === f || (a.folder ?? "").startsWith(`${f}/`)).length;

  return (
    <SelectionList>
      <PanelHeader title="Assets">
        <Popover open={menu} onOpenChange={setMenu}>
          <PopoverTrigger render={<AddButton label="Add to assets" />} />
          <PopoverContent container={portal} align="end" className="w-44 gap-0 rounded-[var(--typren-radius-control)] p-1">
            {onCreate && (
              <button type="button" onClick={() => (setMenu(false), setAdding(true))} className={MENU_ROW}>
                <FolderPlus className="size-4" /> New folder
              </button>
            )}
            <button type="button" onClick={() => (setMenu(false), fileRef.current?.click())} className={MENU_ROW}>
              <Upload className="size-4" /> Upload
            </button>
          </PopoverContent>
        </Popover>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          aria-label="Upload images"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </PanelHeader>
      {adding && onCreate && (
        <NewFolderField
          parent={current}
          siblings={(folders ?? []).filter((f) => parentOf(f) === current).map(leafOf)}
          onCreate={onCreate}
          onDone={(folder) => {
            setAdding(false);
            if (folder) onOpen(folder);
          }}
        />
      )}
      <ul className="space-y-1 px-3 pb-4">
        <FolderRows
          folders={folders ?? []}
          rootLabel="All Assets"
          current={current}
          count={(f) => (f ? inside(f) : assets.length)}
          onOpen={onOpen}
          onRename={onRename}
          onDelete={onDelete}
          onMove={onMove}
        />
      </ul>
    </SelectionList>
  );
}

/** Which kind of template Website → Templates shows. */
export type TemplatesView = "sections" | "pages";

/** Level 1: Templates, its two kinds, each the root of its folder tree:
 *  saved sections (with the fixed Built-in folder of slice types) and page
 *  templates. Rows take dragged items of their own kind, rename and delete
 *  like the Assets tree; + makes a folder in the one shown. `rev` reloads the
 *  lists after the main pane changed them; `onChange` reports the rail's. */
export function TemplatesLevel({
  current,
  folder = "",
  pages = true,
  library,
  builtIns = 0,
  rev,
  onOpen,
  onChange = () => {},
}: Readonly<{
  current: TemplatesView;
  /** The folder shown in `current`. */
  folder?: string;
  /** False when the host's library has no page templates: Sections alone. */
  pages?: boolean;
  library?: SliceLibrary;
  /** How many slice types the Built-in folder holds. */
  builtIns?: number;
  rev?: number;
  onOpen: (view: TemplatesView, folder?: string) => void;
  onChange?: () => void;
}>) {
  type Lists = { items: { folder?: string }[]; folders: string[] };
  const [data, setData] = useState<{ sections: Lists; pages: Lists } | null>(null);
  const [adding, setAdding] = useState(false);
  const templates = pages ? library?.templates : undefined;
  useEffect(() => {
    if (!library) return;
    let live = true;
    void Promise.all([library.list(), library.folders?.list(), templates?.list(), templates?.folders?.list()]).then(
      ([saved, savedFolders, tpls, tplFolders]) =>
        live && setData({ sections: { items: saved, folders: savedFolders ?? [] }, pages: { items: tpls ?? [], folders: tplFolders ?? [] } }),
      () => live && setData({ sections: { items: [], folders: [] }, pages: { items: [], folders: [] } })
    );
    return () => {
      live = false;
    };
  }, [library, templates, rev]);
  const lists = data ?? { sections: { items: [], folders: [] }, pages: { items: [], folders: [] } };
  const libs = { sections: library, pages: templates };
  const after = (fn: () => Promise<void>) => fn().finally(onChange);
  const tree = (view: TemplatesView, rootLabel: string, dragType: string) => {
    const { items, folders } = lists[view];
    const lib = libs[view];
    const ops = lib?.folders;
    const shown = view === "sections" && builtIns ? [BUILT_IN_FOLDER, ...folders] : folders;
    const inside = (f: string) => items.filter((i) => i.folder === f || i.folder?.startsWith(`${f}/`)).length;
    return (
      <FolderRows
        key={view}
        folders={shown}
        rootLabel={rootLabel}
        current={view === current ? folder : null}
        count={(f) => (f === BUILT_IN_FOLDER ? builtIns : f ? inside(f) : items.length + (view === "sections" ? builtIns : 0))}
        label={folderLabel}
        fixed={[BUILT_IN_FOLDER]}
        dragType={dragType}
        onOpen={(f) => onOpen(view, f)}
        onRename={ops && ((f, to) => after(() => ops.rename(f, to)))}
        onDelete={ops && ((f) => after(() => ops.delete(f)))}
        onMove={lib?.move && ((id, f) => void after(async () => void (await lib.move!(id, f))))}
      />
    );
  };
  const creator = libs[current]?.folders;
  const parent = folder === BUILT_IN_FOLDER ? "" : folder;
  return (
    <SelectionList>
      <PanelHeader title="Templates">
        {creator && (
          <AddButton label="New folder" icon={<FolderPlus />} onClick={() => setAdding(true)} />
        )}
      </PanelHeader>
      {adding && creator && (
        <NewFolderField
          parent={parent}
          siblings={lists[current].folders.filter((f) => parentOf(f) === parent).map(leafOf)}
          onCreate={(f) => after(() => creator.create(f))}
          onDone={(f) => {
            setAdding(false);
            if (f) onOpen(current, f);
          }}
        />
      )}
      <Loading
        ready={!library || !!data}
        className="flex-col"
        skeleton={<RowsSkeleton count={pages ? 2 : 1} />}
      >
        <ul className="space-y-1 px-3 pb-4">
          {tree("sections", "Sections", SECTION_DRAG_TYPE)}
          {pages && tree("pages", "Pages", TEMPLATE_DRAG_TYPE)}
        </ul>
      </Loading>
    </SelectionList>
  );
}
