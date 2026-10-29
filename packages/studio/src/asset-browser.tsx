"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Copy, Folder, FolderInput, ImageOff, Info, LayoutGrid, List, Pencil, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { nameError, type MediaAsset, type MediaUse } from "@typren/core";
import { AssetViewer, UsageList, totalUses } from "./asset-viewer";
import { useMediaUrl } from "./media-url";
import { formatDate } from "./format";
import { humanSize } from "./media-grid";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./primitives/context-menu";
import { DataTable, sortRows, type Sort } from "./primitives/data-table";
import { EmptyState } from "./primitives/empty";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives/popover";
import { usePortal } from "./primitives/portal";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./primitives/select";
import { useStoredChoice } from "./use-stored-choice";
import { ToggleGroup, ToggleGroupItem } from "./primitives/toggle-group";
import { DROP_RING, folderDrop } from "./primitives/sortable";

/** Drag payload type for an asset id, read by folder tiles and rail rows. */
export const ASSET_DRAG_TYPE = "application/x-typren-asset";

export type AssetView = "gallery" | "list";

/** A folder inside the one being browsed: its direct child count, and the
 *  bytes of every asset under it, nested folders included. */
export type Subfolder = { folder: string; items: number; size: number };

const SORT_CHOICES = ["", ...["name", "dimensions", "size", "used", "added"].flatMap((id) => [`${id}:asc`, `${id}:desc`])];

type Row = { kind: "folder"; f: Subfolder } | { kind: "asset"; a: MediaAsset };

/** Painted behind an image's own box: opaque pixels cover it, transparent
 *  ones show it. Mid-grey squares, so white and black artwork both read.
 *  Mixed from theme tokens, so it follows dark mode. */
const CHECKER: CSSProperties = {
  backgroundImage:
    "repeating-conic-gradient(color-mix(in oklch, var(--typren-muted-fg) 45%, var(--typren-card)) 0 25%, color-mix(in oklch, var(--typren-muted-fg) 20%, var(--typren-card)) 0 50%)",
  backgroundSize: "12px 12px",
};

// An action in the hover pill: the pill is concentric with the thumbnail's
// corner (8px), and its 4px padding leaves these the floor radius.
const PILL_ACTION = "rounded-[var(--typren-radius-min)]";

const leaf = (folder: string) => folder.slice(folder.lastIndexOf("/") + 1);

/** `value` as text that becomes editable in place while `editing`: same
 *  font, same spot, the name selected so typing replaces it (up to `keep`, an
 *  extension, when given, the way Finder leaves ".png" out of the selection). Enter or blur
 *  commits a changed value, Escape restores the old one. The caller owns
 *  `editing`, so a double click and a context-menu Rename both start it. */
export function InlineRename({
  value,
  editing,
  onDone,
  keep = "",
  validate,
  className,
}: Readonly<{
  value: string;
  editing: boolean;
  onDone: (next: string | null) => void;
  keep?: string;
  /** Why the typed name can't be used, or null. While it returns a reason,
   *  the reason shows under the name, Enter does nothing, and leaving the
   *  field puts the old name back. */
  validate?: (next: string) => string | null;
  className?: string;
}>) {
  const ref = useRef<HTMLSpanElement>(null);
  const portal = usePortal();
  const [error, setError] = useState<{ message: string; left: number; top: number } | null>(null);
  const check = () => {
    const el = ref.current!;
    const message = validate?.(el.textContent?.trim() ?? "");
    const box = el.getBoundingClientRect();
    setError(message ? { message, left: box.left, top: box.bottom + 6 } : null);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (keep && el.firstChild && value.endsWith(keep)) range.setEnd(el.firstChild, value.length - keep.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [editing]);
  const finish = (commit: boolean) => {
    const el = ref.current!;
    const next = el.textContent?.trim() ?? "";
    el.textContent = value;
    setError(null);
    onDone(commit && next && next !== value && !validate?.(next) ? next : null);
  };
  return (
    <>
    <span
      ref={ref}
      role={editing ? "textbox" : undefined}
      aria-label={editing ? `Rename ${value}` : undefined}
      contentEditable={editing ? "plaintext-only" : undefined}
      suppressContentEditableWarning
      spellCheck={false}
      onClick={(e) => editing && e.stopPropagation()}
      aria-invalid={editing && error ? true : undefined}
      onInput={check}
      onBlur={() => editing && finish(true)}
      onKeyDown={(e) => {
        if (!editing) return;
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          if (!error) finish(true);
        }
        if (e.key === "Escape") finish(false);
      }}
      className={cn(
        className,
        editing &&
          "cursor-text rounded-[var(--typren-radius-sm)] outline-none ring-2 ring-[var(--typren-ring)] aria-invalid:ring-[var(--typren-destructive)] ring-offset-1 ring-offset-[var(--typren-card)] [display:block] [-webkit-line-clamp:unset] [text-overflow:clip] [white-space:normal]"
      )}
    >
      {value}
    </span>
    {editing &&
      error &&
      // Fixed and portalled: the name sits in clipped, truncated cells.
      createPortal(
        <span
          role="alert"
          style={{ left: error.left, top: error.top }}
          className="fixed z-50 max-w-56 rounded-[var(--typren-radius-sm)] bg-[var(--typren-popover)] px-2 py-1 text-xs text-[var(--typren-destructive)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)]"
        >
          {error.message}
        </span>,
        portal ?? document.body
      )}
    </>
  );
}

/** Right-click menu shared by folder and asset tiles. */
export function ItemMenu({
  children,
  onRename,
  onCopy,
  onDelete,
}: Readonly<{ children: ReactNode; onRename?: () => void; onCopy?: () => void; onDelete?: () => void }>) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
      {/* Focus stays where the action puts it, so Rename's in-place edit keeps it. */}
      <ContextMenuContent finalFocus={false}>
        {onRename && (
          <ContextMenuItem onClick={onRename}>
            <Pencil /> Rename
          </ContextMenuItem>
        )}
        {onCopy && (
          <ContextMenuItem onClick={onCopy}>
            <Copy /> Copy URL
          </ContextMenuItem>
        )}
        {onDelete && (
          <ContextMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 /> Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
const dims = (a: MediaAsset) => (a.width && a.height ? `${a.width}×${a.height}` : humanSize(a.size));

export function AssetViewToggle({ view, onChange }: Readonly<{ view: AssetView; onChange: (v: AssetView) => void }>) {
  return (
    <ToggleGroup aria-label="View" value={[view]} onValueChange={([next]) => next && onChange(next as AssetView)}>
      <ToggleGroupItem value="gallery" aria-label="Gallery">
        <LayoutGrid className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List">
        <List className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

const VIEWS: AssetView[] = ["gallery", "list"];

/** Slides the browser's content when the view toggle changes, the way the
 *  toggle reads: on to List pushes it left, back to Gallery pushes it
 *  right. Spread the ref on the content under the breadcrumb, which stays
 *  put. Same easing as the rail's slide, shorter since it moves within a
 *  screen; reduced motion swaps instantly. */
export function useViewSlide(view: AssetView) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(view);
  useLayoutEffect(() => {
    const dir = VIEWS.indexOf(view) - VIEWS.indexOf(last.current);
    last.current = view;
    if (!dir || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    ref.current?.animate?.(
      [
        { transform: `translateX(${dir * 48}px)`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 320, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
  }, [view]);
  return ref;
}

/** A hover pill's Move button: a menu of every folder but `from` ("" is the
 *  top level, shown as `rootLabel`). */
export function MoveSelect({
  name,
  from,
  folders,
  rootLabel,
  onMove,
}: Readonly<{ name: string; from: string; folders: string[]; rootLabel: string; onMove: (folder: string) => void }>) {
  return (
    <Select value={null} onValueChange={(f) => f !== null && onMove(f)}>
      <SelectTrigger
        aria-label={`Move ${name}`}
        className="size-8 justify-center rounded-[var(--typren-radius-min)] border-transparent bg-transparent p-0 shadow-none hover:border-transparent hover:bg-[var(--typren-muted)] [&>svg:last-child]:hidden"
      >
        <FolderInput className="size-4" aria-hidden />
      </SelectTrigger>
      <SelectContent>
        {folders
          .filter((f) => f !== from)
          .map((f) => (
            <SelectItem key={f} value={f}>
              {f || rootLabel}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function AssetActions({
  asset,
  folders,
  onMove,
  onDelete,
}: Readonly<{
  asset: MediaAsset;
  folders?: string[];
  onMove?: (id: string, folder: string) => void;
  onDelete: (id: string) => void;
}>) {
  return (
    <>
      <Button variant="ghost" size="icon-sm" className={PILL_ACTION} aria-label={`Copy ${asset.name} URL`} onClick={() => navigator.clipboard.writeText(asset.url)}>
        <Copy />
      </Button>
      {onMove && folders && <MoveSelect name={asset.name} from={asset.folder ?? ""} folders={folders} rootLabel="All Assets" onMove={(f) => onMove(asset.id, f)} />}
      <Button variant="destructive" size="icon-sm" className={PILL_ACTION} aria-label={`Delete ${asset.name}`} onClick={() => onDelete(asset.id)}>
        <Trash2 />
      </Button>
    </>
  );
}

/**
 * Finder's selection over `keys`, shared by the Assets and Sections
 * browsers: one click selects, a double click or Enter opens, Space shows
 * Quick Look, arrows move, Escape clears. Spread `item(key)` on each item
 * and `onKeyDown` on their container; `paused` (an in-place rename) hands
 * the keys back to whatever has focus.
 */
export function useSelection(keys: string[], open: (key: string) => void, quick: (key: string) => void, paused = false) {
  const [selected, setSelected] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  // Roving tabindex: one tab stop, on the selected item (the first, until
  // something is selected); arrows move DOM focus along with the selection.
  const stop = selected !== null && keys.includes(selected) ? selected : keys[0];
  const item = (key: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) els.current.set(key, el);
      else els.current.delete(key);
    },
    tabIndex: key === stop ? 0 : -1,
    "aria-selected": selected === key,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      setSelected(key);
    },
    onDoubleClick: () => open(key),
    onFocus: () => setSelected(key),
  });
  const go = (key: string) => {
    setSelected(key);
    els.current.get(key)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!selected || paused) return;
    const at = keys.indexOf(selected);
    if (e.key === " ") quick(selected);
    else if (e.key === "Enter") open(selected);
    else if (e.key === "Escape") setSelected(null);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(keys[Math.max(0, at - 1)] ?? selected);
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") go(keys[Math.min(keys.length - 1, at + 1)] ?? selected);
    else return;
    e.preventDefault();
  };
  return { selected, setSelected, item, onKeyDown };
}

/**
 * The Assets section's browser, Finder-style: subfolders first, then assets,
 * as a gallery (each image at its true proportions, fitted in a square cell)
 * or a list. One click selects; a double click on an item opens it (a
 * folder, or an asset in the full viewer), while a double click on its name
 * renames. Space shows the selected asset in Quick Look. Files dropped
 * anywhere upload into the current folder; asset tiles drag onto folder
 * tiles and the rail's folder rows to move.
 */
export function AssetBrowser({
  assets: unsortedAssets,
  subfolders: unsortedFolders = [],
  view,
  folders,
  usage,
  onOpenFolder,
  onOpenPage,
  onMove,
  onDelete,
  onUploadFiles,
  onRename,
  onRenameFolder,
  onDeleteFolder,
}: Readonly<{
  assets: MediaAsset[];
  subfolders?: Subfolder[];
  view: AssetView;
  /** Every move target ("" is the top level); omit without folder support. */
  folders?: string[];
  /** Where each asset URL is used; omit to leave usage out. */
  usage?: Record<string, MediaUse[]>;
  onOpenFolder: (folder: string) => void;
  onOpenPage?: (slug: string) => void;
  onMove?: (id: string, folder: string) => void;
  onDelete: (id: string) => void;
  /** `folder` is set when the files were dropped on a folder, else the current one. */
  onUploadFiles: (files: FileList, folder?: string) => void;
  /** New base name for an asset (its extension is kept). */
  onRename?: (id: string, name: string) => void;
  onRenameFolder?: (folder: string, name: string) => void;
  /** Offered only for empty folders. */
  onDeleteFolder?: (folder: string) => void;
}>) {
  const [sortChoice, setSortChoice] = useStoredChoice("typren-asset-sort", "", SORT_CHOICES);
  const resolve = useMediaUrl();
  const sort: Sort | null = sortChoice ? { id: sortChoice.split(":")[0]!, dir: sortChoice.endsWith(":desc") ? "desc" : "asc" } : null;
  const [over, setOver] = useState<string | null>(null);
  // Each group sorts on its own, so folders stay ahead of assets as in Finder.
  const sortBy: Record<string, (r: Row) => string | number> = {
    name: (r) => (r.kind === "folder" ? leaf(r.f.folder) : r.a.name),
    dimensions: (r) => (r.kind === "folder" ? r.f.items : (r.a.width ?? 0) * (r.a.height ?? 0)),
    size: (r) => (r.kind === "folder" ? r.f.size : r.a.size),
    used: (r) => (r.kind === "folder" || !usage ? 0 : totalUses(usage[r.a.url] ?? [])),
    added: (r) => (r.kind === "folder" ? 0 : Date.parse(r.a.createdAt)),
  };
  const order = <T,>(items: T[], row: (x: T) => Row) =>
    sortRows(items, Object.entries(sortBy).map(([id, get]) => ({ id, header: "", cell: () => null, sort: (x: T) => get(row(x)) })), sort);
  const subfolders = order(unsortedFolders, (f) => ({ kind: "folder", f }));
  const assets = order(unsortedAssets, (a) => ({ kind: "asset", a }));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; mode: "full" | "quick" } | null>(null);
  const slide = useViewSlide(view);
  // Folders are keyed "folder:<path>", assets by id, in one selection.
  const { selected, setSelected, item, onKeyDown } = useSelection(
    [...subfolders.map((f) => `folder:${f.folder}`), ...assets.map((a) => a.id)],
    (key) => {
      if (key.startsWith("folder:")) onOpenFolder(key.slice("folder:".length));
      else setViewing({ id: key, mode: "full" });
    },
    (key) => !key.startsWith("folder:") && setViewing({ id: key, mode: "quick" }),
    !!renaming
  );
  // A double click on a name renames it instead of opening the item.
  const nameProps = (start: () => void) => ({
    onDoubleClick: (e: MouseEvent) => {
      e.stopPropagation();
      start();
    },
  });
  const extOf = (name: string) => /\.[^.]+$/.exec(name)?.[0] ?? "";
  const folderName = (f: Subfolder) => (
    <InlineRename
      value={leaf(f.folder)}
      editing={renaming === `folder:${f.folder}`}
      className="line-clamp-2 break-all text-center"
      validate={(next) => nameError(next, subfolders.filter((g) => g !== f).map((g) => leaf(g.folder)))}
      onDone={(next) => {
        setRenaming(null);
        if (next) onRenameFolder?.(f.folder, next);
      }}
    />
  );
  const assetName = (a: MediaAsset, className: string) => (
    <InlineRename
      value={a.name}
      keep={extOf(a.name)}
      editing={renaming === a.id}
      className={className}
      validate={(next) => nameError(next, assets.filter((b) => b !== a).map((b) => b.name), extOf(a.name))}
      onDone={(next) => {
        setRenaming(null);
        // The extension is the file's type: it stays (the adapter re-adds it).
        const ext = extOf(a.name);
        if (next) onRename?.(a.id, next.endsWith(ext) ? next.slice(0, -ext.length) : next);
      }}
    />
  );
  const folderMenu = (f: Subfolder, child: ReactNode) => (
    <ItemMenu
      onRename={onRenameFolder && (() => setRenaming(`folder:${f.folder}`))}
      onDelete={onDeleteFolder && f.items === 0 ? () => onDeleteFolder(f.folder) : undefined}
    >
      {child}
    </ItemMenu>
  );
  const assetMenu = (a: MediaAsset, child: ReactNode) => (
    <ItemMenu
      onRename={onRename && (() => setRenaming(a.id))}
      onCopy={() => navigator.clipboard.writeText(a.url)}
      onDelete={() => onDelete(a.id)}
    >
      {child}
    </ItemMenu>
  );
  const dropOn = (folder: string) => folderDrop(folder, { onMove, onFiles: onUploadFiles, setOver, type: ASSET_DRAG_TYPE });
  const drag = (a: MediaAsset) => ({
    draggable: !!onMove,
    onDragStart: (e: DragEvent) => e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id),
  });
  // Finder's highlight: a grey box behind the thumbnail, a filled pill on the name.
  const thumb = (key: string) =>
    cn(
      "flex aspect-square w-full items-center justify-center rounded-[var(--typren-radius-control)] transition-colors duration-150 motion-reduce:transition-none",
      key === `folder:${over}` && DROP_RING,
      selected === key ? "typren-selected relative bg-[var(--typren-fill-subtle-selected)]" : "group-hover:bg-[var(--typren-fill-subtle-hover)]"
    );
  const pill = (key: string) =>
    cn(
      "max-w-full rounded-[var(--typren-radius-sm)] px-1.5 text-center text-sm",
      selected === key ? "bg-[var(--typren-fg)] text-[var(--typren-card)]" : "text-[var(--typren-fg)]"
    );

  const empty = assets.length === 0 && subfolders.length === 0;

  return (
    <div
      ref={slide}
      className="min-h-full outline-none"
      onClick={() => setSelected(null)}
      onKeyDown={onKeyDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) onUploadFiles(e.dataTransfer.files);
      }}
    >
      {empty ? (
        <EmptyState icon={<ImageOff />} title="Drop images here, or use + to upload." />
      ) : view === "gallery" ? (
        <ul role="listbox" aria-label="Assets" className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-4 gap-y-6">
          {subfolders.map((f) => {
            const key = `folder:${f.folder}`;
            return (
              <li key={f.folder} role="option" aria-label={leaf(f.folder)} {...item(key)} {...dropOn(f.folder)} className="group relative outline-none">
                {folderMenu(
                  f,
                  <div className="flex w-full flex-col items-center gap-1.5">
                    <div className={cn(thumb(key), "group-focus-visible:ring-2 group-focus-visible:ring-[var(--typren-ring)]")}>
                      <Folder className="size-20 fill-[var(--typren-muted)] stroke-[1.25] text-[var(--typren-muted-fg)]" aria-hidden />
                    </div>
                    <span className={pill(key)} {...nameProps(() => onRenameFolder && setRenaming(key))}>
                      {folderName(f)}
                    </span>
                    <span className="text-xs text-[var(--typren-muted-fg)]">
                      {f.items} {f.items === 1 ? "item" : "items"} · {humanSize(f.size)}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
          {assets.map((a) => (
            <li key={a.id} role="presentation" className="group/tile relative">
<div role="option" aria-label={a.name} {...item(a.id)} {...drag(a)} className="group relative outline-none">
              {assetMenu(
                a,
                <div className="flex flex-col items-center gap-1.5">
                  <div className={cn(thumb(a.id), "p-3 [--typren-inset:12px] group-focus-visible:ring-2 group-focus-visible:ring-[var(--typren-ring)]")}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- content-authored path has no static-import metadata next/image needs */}
                    <img
                      decoding="async"
                      src={resolve(a.url)}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      style={CHECKER}
                      className="typren-concentric max-h-full max-w-full object-contain shadow-sm ring-1 ring-[var(--typren-border)]"
                    />
                  </div>
                  <span className={pill(a.id)} {...nameProps(() => onRename && setRenaming(a.id))}>
                    {assetName(a, "line-clamp-2 break-all")}
                  </span>
                  <span className="text-xs text-[var(--typren-muted-fg)]">{dims(a)}</span>
                </div>
              )}
</div>
              <div
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="typren-concentric absolute right-1 top-1 flex gap-0.5 bg-[var(--typren-card)] p-1 opacity-0 shadow-sm ring-1 ring-[var(--typren-border)] transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100"
              >
                <AssetActions asset={a} folders={folders} onMove={onMove} onDelete={onDelete} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <DataTable<Row>
          gutter={24}
          stickyTop={48}
          rows={[...subfolders.map((f) => ({ kind: "folder" as const, f })), ...assets.map((a) => ({ kind: "asset" as const, a }))]}
          rowKey={(r) => (r.kind === "folder" ? `folder:${r.f.folder}` : r.a.id)}
          rowProps={(r) => {
            const key = r.kind === "folder" ? `folder:${r.f.folder}` : r.a.id;
            return {
              ...item(key),
              ...(r.kind === "folder" ? dropOn(r.f.folder) : drag(r.a)),
              className: cn(
                "group h-12 cursor-default outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--typren-ring)]",
                selected === key && "bg-[var(--typren-fill-subtle-selected)] hover:bg-[var(--typren-fill-subtle-selected)]",
                r.kind === "folder" && over === r.f.folder && cn(DROP_RING, "ring-inset")
              ),
            };
          }}
          sort={sort}
          onSort={(next) => setSortChoice(next ? `${next.id}:${next.dir}` : "")}
          columns={[
            {
              id: "name",
              sort: sortBy.name,
              header: "Name",
              width: 232,
              cell: (r) =>
                r.kind === "folder" ? (
                  folderMenu(
                    r.f,
                    <span className="flex items-center gap-3">
                      <Folder className="size-8 shrink-0 fill-[var(--typren-muted)] stroke-[1.25] text-[var(--typren-muted-fg)]" aria-hidden />
                      <span className="min-w-0" {...nameProps(() => onRenameFolder && setRenaming(`folder:${r.f.folder}`))}>
                        {folderName(r.f)}
                      </span>
                    </span>
                  )
                ) : (
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element -- content-authored path has no static-import metadata next/image needs */}
                      <img src={resolve(r.a.url)} alt="" loading="lazy" decoding="async" draggable={false} style={CHECKER} className="max-h-full max-w-full rounded-[var(--typren-radius-sm)] object-contain ring-1 ring-[var(--typren-border)]" />
                    </span>
                    <span className="min-w-0 flex-1" {...nameProps(() => onRename && setRenaming(r.a.id))}>
                      {assetMenu(r.a, assetName(r.a, "block truncate"))}
                    </span>
                  </span>
                ),
            },
            {
              id: "dimensions",
              sort: sortBy.dimensions,
              header: "Dimensions",
              width: 108,
              className: "text-[var(--typren-muted-fg)]",
              cell: (r) =>
                r.kind === "folder"
                  ? `${r.f.items} ${r.f.items === 1 ? "item" : "items"}`
                  : r.a.width && r.a.height
                    ? `${r.a.width}×${r.a.height}`
                    : "—",
            },
            { id: "size", sort: sortBy.size, header: "Size", width: 72, className: "text-[var(--typren-muted-fg)]", cell: (r) => humanSize(r.kind === "asset" ? r.a.size : r.f.size) },
            ...(usage
              ? [
                  {
                    id: "used",
                    sort: sortBy.used,
                    header: "Used",
                    width: 72,
                    className: "text-[var(--typren-muted-fg)]",
                    cell: (r: Row) => r.kind === "asset" && <UsageCell asset={r.a} uses={usage[r.a.url] ?? []} onOpenPage={onOpenPage} />,
                  },
                ]
              : []),
            { id: "added", sort: sortBy.added, header: "Added", width: 112, className: "text-[var(--typren-muted-fg)]", cell: (r) => (r.kind === "asset" ? formatDate(r.a.createdAt) : "") },
            {
              id: "actions",
              header: <span className="sr-only">Actions</span>,
              width: 108,
              resizable: false,
              cell: (r) =>
                r.kind === "asset" && (
                  <span
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="flex justify-end gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <AssetActions asset={r.a} folders={folders} onMove={onMove} onDelete={onDelete} />
                  </span>
                ),
            },
          ]}
        />
      )}
      {viewing && (
        <AssetViewer
          assets={assets}
          id={viewing.id}
          mode={viewing.mode}
          uses={usage && (usage[assets.find((a) => a.id === viewing.id)?.url ?? ""] ?? [])}
          checker={CHECKER}
          onStep={(id) => {
            setSelected(id);
            setViewing({ ...viewing, id });
          }}
          onClose={() => setViewing(null)}
          onOpenPage={onOpenPage}
        />
      )}
    </div>
  );
}

/** A list row's use count, with an info button listing the pages. Hover or
 *  click opens it; it closes once the pointer leaves the button and popup. */
function UsageCell({
  asset,
  uses,
  onOpenPage,
}: Readonly<{ asset: MediaAsset; uses: MediaUse[]; onOpenPage?: (slug: string) => void }>) {
  const portal = usePortal();
  const [open, setOpen] = useState(false);
  const closing = useRef<number>(undefined);
  // A click-opened popover would otherwise stay put; leaving the button and
  // the popup closes it either way, after a beat to cross the gap between them.
  const hover = {
    onPointerEnter: () => window.clearTimeout(closing.current),
    onPointerLeave: () => {
      closing.current = window.setTimeout(() => setOpen(false), 150);
    },
  };
  return (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="tabular-nums">{totalUses(uses)}</span>
      <Popover
        open={open}
        // Hover has usually opened it by the time the click lands; a click
        // that toggled would shut it again, so pressing the button only opens.
        onOpenChange={(next, details) => (next || details.reason !== "trigger-press") && setOpen(next)}
      >
        <PopoverTrigger
          openOnHover
          delay={150}
          {...hover}
          render={<Button variant="ghost" size="icon-sm" aria-label={`Where ${asset.name} is used`} className="size-6" />}
        >
          <Info className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent container={portal} align="start" className="gap-1.5 rounded-[var(--typren-radius-control)] p-1" {...hover}>
          <p className="px-2 pt-1 text-xs text-[var(--typren-muted-fg)]">
            {uses.length ? `Used on ${uses.length} ${uses.length === 1 ? "page" : "pages"}` : asset.name}
          </p>
          <UsageList uses={uses} onOpenPage={onOpenPage} />
        </PopoverContent>
      </Popover>
    </span>
  );
}
