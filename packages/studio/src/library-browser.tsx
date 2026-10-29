"use client";

import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { Folder, Trash2 } from "lucide-react";
import { BUILT_IN_FOLDER, nameError } from "@typren/core";
import { InlineRename, ItemMenu, MoveSelect, useSelection, useViewSlide, type AssetView } from "./asset-browser";
import { FolderBar } from "./folder-bar";
import { formatDate } from "./format";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { DataTable, DataTableSkeleton, type DataColumn } from "./primitives/data-table";
import { EmptyState } from "./primitives/empty";
import { DROP_RING, folderDrop } from "./primitives/sortable";
import { ScrollArea } from "./primitives/scroll-area";
import { Loading, TileGridSkeleton } from "./primitives/skeleton";

/** One browsable library entry. No `savedAt` means the studio's code ships
 *  it (a built-in or a starter): it can't be renamed, moved or deleted. */
export type LibraryItem = { id: string; name: string; savedAt?: string; folder?: string };

/** What the browser's caller renders as the open item's viewer. */
export type LibraryViewing<T> = {
  item: T;
  index: number;
  count: number;
  mode: "full" | "quick";
  step: (by: number) => void;
  close: () => void;
  /** Opens another item (one just saved), in its own folder. */
  open: (item: T) => void;
};

const leaf = (folder: string) => folder.slice(folder.lastIndexOf("/") + 1);
const parentOf = (f: string) => f.slice(0, Math.max(0, f.lastIndexOf("/")));
/** A folder's name, with the reserved built-in group spelled as the UI says it. */
export const folderLabel = (f: string) => (f === BUILT_IN_FOLDER ? "Built-in" : leaf(f));

type Row<T> = { kind: "folder"; folder: string; items: number } | { kind: "item"; item: T };

/**
 * Templates → Sections and Templates → Pages, browsed the way Assets is:
 * the breadcrumb bar, subfolders first, then items, as a gallery of
 * `thumb`s or a list, with Finder's selection (one click selects, a double
 * click or Enter opens, Space shows Quick Look). Saved items rename in place,
 * drag onto folders (tiles, crumbs, the rail) or move from their hover pill,
 * and delete. Built-ins sit in the fixed Built-in folder. The caller owns
 * the data and renders the viewer.
 */
export function LibraryBrowser<T extends LibraryItem>({
  label,
  items,
  folders,
  folder,
  view,
  ready,
  dragType,
  thumb,
  icon,
  meta,
  column,
  empty,
  onOpenFolder,
  onRename,
  onMove,
  onDelete,
  onRenameFolder,
  onDeleteFolder,
  viewer,
  around = (grid) => grid,
}: Readonly<{
  /** The library's name: the listbox label and the root crumb. */
  label: string;
  /** Every item, in every folder. */
  items: T[];
  /** Saved folder paths; undefined when the library has no folders. */
  folders?: string[];
  folder: string;
  view: AssetView;
  /** False while the lists load: a skeleton holds their place. */
  ready: boolean;
  dragType: string;
  thumb: (item: T) => ReactNode;
  /** A list row's glyph: a rendered thumbnail per row would load a frame each. */
  icon: ReactNode;
  /** The line under a gallery tile. */
  meta: (item: T) => string;
  /** The list's library-specific column (slice type, section count). */
  column: { header: string; cell: (item: T) => ReactNode };
  empty: ReactNode;
  onOpenFolder: (folder: string) => void;
  onRename?: (item: T, name: string) => void;
  onMove?: (item: T, folder: string) => void;
  onDelete?: (item: T) => void;
  onRenameFolder?: (folder: string, to: string) => void;
  onDeleteFolder?: (folder: string) => void;
  viewer: (v: LibraryViewing<T>) => ReactNode;
  /** Wraps the gallery grid, inside the scrolling content (the Sections
   *  screen lays its one preview frame over the grid this way). */
  around?: (grid: ReactNode) => ReactNode;
}>) {
  const [over, setOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; mode: "full" | "quick" } | null>(null);
  const slide = useViewSlide(view);
  const builtIns = items.some((i) => i.folder === BUILT_IN_FOLDER);
  const all = [...(builtIns ? [BUILT_IN_FOLDER] : []), ...(folders ?? [])];
  const at = (i: T) => i.folder ?? "";
  const shown = items.filter((i) => at(i) === folder);
  const subfolders = all
    .filter((f) => parentOf(f) === folder)
    .map((f) => ({ folder: f, items: items.filter((i) => at(i) === f).length + all.filter((g) => parentOf(g) === f).length }));
  const fixed = (f: string) => f === BUILT_IN_FOLDER;
  const saved = (i: T) => !!i.savedAt;
  // Move targets: the top level and every saved folder, never Built-in.
  const targets = folders && ["", ...folders];
  const move = onMove && ((id: string, to: string) => {
    const item = items.find((i) => i.id === id);
    if (item && saved(item) && at(item) !== to && !fixed(to)) onMove(item, to);
  });
  const dropOn = (f: string) => (fixed(f) ? {} : folderDrop(f, { onMove: move, setOver, type: dragType }));

  const { selected, setSelected, item: selectable, onKeyDown } = useSelection(
    [...subfolders.map((f) => `folder:${f.folder}`), ...shown.map((i) => i.id)],
    (key) => (key.startsWith("folder:") ? onOpenFolder(key.slice("folder:".length)) : setViewing({ id: key, mode: "full" })),
    (key) => !key.startsWith("folder:") && setViewing({ id: key, mode: "quick" }),
    !!renaming
  );
  // A double click on a name renames it instead of opening the item.
  const nameProps = (start?: () => void) => ({
    onDoubleClick: (e: MouseEvent) => {
      if (!start) return;
      e.stopPropagation();
      start();
    },
  });
  const folderName = (f: string, className: string) => (
    <InlineRename
      value={folderLabel(f)}
      editing={renaming === `folder:${f}`}
      className={className}
      validate={(next) => nameError(next, subfolders.filter((g) => g.folder !== f).map((g) => leaf(g.folder)))}
      onDone={(next) => {
        setRenaming(null);
        if (next) onRenameFolder?.(f, parentOf(f) ? `${parentOf(f)}/${next}` : next);
      }}
    />
  );
  const itemName = (i: T, className: string) => (
    <InlineRename
      value={i.name}
      editing={renaming === i.id}
      className={className}
      onDone={(next) => {
        setRenaming(null);
        if (next) onRename?.(i, next);
      }}
    />
  );
  const renameFolder = (f: string) => (onRenameFolder && !fixed(f) ? () => setRenaming(`folder:${f}`) : undefined);
  const renameItem = (i: T) => (onRename && saved(i) ? () => setRenaming(i.id) : undefined);
  const folderMenu = (f: { folder: string; items: number }, child: ReactNode) => (
    <ItemMenu
      onRename={renameFolder(f.folder)}
      onDelete={onDeleteFolder && !fixed(f.folder) && f.items === 0 ? () => onDeleteFolder(f.folder) : undefined}
    >
      {child}
    </ItemMenu>
  );
  const itemMenu = (i: T, child: ReactNode) => (
    <ItemMenu onRename={renameItem(i)} onDelete={onDelete && saved(i) ? () => onDelete(i) : undefined}>
      {child}
    </ItemMenu>
  );
  const drag = (i: T) => ({
    draggable: !!move && saved(i),
    onDragStart: (e: DragEvent) => e.dataTransfer.setData(dragType, i.id),
  });
  const actions = (i: T) =>
    saved(i) && (
      <>
        {move && targets && <MoveSelect name={i.name} from={at(i)} folders={targets} rootLabel={label} onMove={(f) => move(i.id, f)} />}
        {onDelete && (
          <Button variant="destructive" size="icon-sm" className="rounded-[var(--typren-radius-min)]" aria-label={`Delete ${i.name}`} onClick={() => onDelete(i)}>
            <Trash2 />
          </Button>
        )}
      </>
    );
  const stop = { onClick: (e: MouseEvent) => e.stopPropagation(), onDoubleClick: (e: MouseEvent) => e.stopPropagation() };
  // Finder's highlight: a fill behind the thumbnail, an inverted name.
  const tile = (key: string) =>
    cn(
      "w-full rounded-[var(--typren-radius-card)] p-(--typren-inset-card) transition-colors duration-150 motion-reduce:transition-none group-focus-visible:ring-2 group-focus-visible:ring-[var(--typren-ring)]",
      key === `folder:${over}` && DROP_RING,
      selected === key ? "typren-selected relative bg-[var(--typren-fill-subtle-selected)]" : "group-hover:bg-[var(--typren-fill-subtle-hover)]"
    );
  const pill = (key: string) =>
    cn("max-w-full rounded-[var(--typren-radius-sm)] px-1.5 text-center text-sm", selected === key ? "bg-[var(--typren-fg)] text-[var(--typren-card)]" : "text-[var(--typren-fg)]");
  const count = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

  const open = viewing && items.find((i) => i.id === viewing.id);
  const siblings = open ? items.filter((i) => at(i) === at(open)) : [];
  const index = open ? siblings.indexOf(open) : -1;

  const body =
    subfolders.length === 0 && shown.length === 0 ? (
      empty
    ) : view === "gallery" ? (
      <ul role="listbox" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-4 gap-y-6">
        {subfolders.map((f) => {
          const key = `folder:${f.folder}`;
          return (
            <li key={key} role="option" aria-label={folderLabel(f.folder)} {...selectable(key)} {...dropOn(f.folder)} className="group relative outline-none">
              {folderMenu(
                f,
                <div className="flex flex-col items-center gap-1.5">
                  <div className={tile(key)}>
                    <div className="flex aspect-[4/3] w-full items-center justify-center">
                      <Folder className="size-20 fill-[var(--typren-muted)] stroke-[1.25] text-[var(--typren-muted-fg)]" aria-hidden />
                    </div>
                  </div>
                  <span className={pill(key)} {...nameProps(renameFolder(f.folder))}>
                    {folderName(f.folder, "line-clamp-2 break-all")}
                  </span>
                  <span className="text-xs text-[var(--typren-muted-fg)]">{count(f.items)}</span>
                </div>
              )}
            </li>
          );
        })}
        {shown.map((i) => (
          <li key={i.id} role="presentation" className="group/tile relative">
            <div role="option" aria-label={i.name} {...selectable(i.id)} {...drag(i)} className="group relative outline-none">
              {itemMenu(
                i,
                <div className="flex flex-col items-center gap-1.5">
                  <div className={tile(i.id)}>{thumb(i)}</div>
                  <span className={pill(i.id)} {...nameProps(renameItem(i))}>
                    {itemName(i, "line-clamp-2 break-all")}
                  </span>
                  <span className="text-xs text-[var(--typren-muted-fg)]">{meta(i)}</span>
                </div>
              )}
            </div>
            {saved(i) && (
              <div
                {...stop}
                className="typren-concentric absolute right-(--typren-inset-card) z-[2] top-(--typren-inset-card) flex gap-0.5 bg-[var(--typren-card)] p-1 opacity-0 shadow-sm ring-1 ring-[var(--typren-border)] transition-opacity focus-within:opacity-100 group-hover/tile:opacity-100"
              >
                {actions(i)}
              </div>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <DataTable<Row<T>>
        gutter={24}
        stickyTop={48}
        rows={[...subfolders.map((f) => ({ kind: "folder" as const, ...f })), ...shown.map((item) => ({ kind: "item" as const, item }))]}
        rowKey={(r) => (r.kind === "folder" ? `folder:${r.folder}` : r.item.id)}
        rowProps={(r) => {
          const key = r.kind === "folder" ? `folder:${r.folder}` : r.item.id;
          return {
            ...selectable(key),
            ...(r.kind === "folder" ? dropOn(r.folder) : drag(r.item)),
            className: cn(
              "group h-12 cursor-default outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--typren-ring)]",
              selected === key && "bg-[var(--typren-fill-subtle-selected)] hover:bg-[var(--typren-fill-subtle-selected)]",
              r.kind === "folder" && over === r.folder && cn(DROP_RING, "ring-inset")
            ),
          };
        }}
        columns={
          [
            {
              id: "name",
              header: "Name",
              width: 280,
              cell: (r) =>
                r.kind === "folder" ? (
                  folderMenu(
                    r,
                    <span className="flex items-center gap-3">
                      <Folder className="size-8 shrink-0 fill-[var(--typren-muted)] stroke-[1.25] text-[var(--typren-muted-fg)]" aria-hidden />
                      <span className="min-w-0" {...nameProps(renameFolder(r.folder))}>
                        {folderName(r.folder, "block truncate")}
                      </span>
                    </span>
                  )
                ) : (
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center text-[var(--typren-muted-fg)] [&_svg]:size-5" aria-hidden>
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1" {...nameProps(renameItem(r.item))}>
                      {itemMenu(r.item, itemName(r.item, "block truncate"))}
                    </span>
                  </span>
                ),
            },
            {
              id: "column",
              header: column.header,
              width: 160,
              className: "text-[var(--typren-muted-fg)]",
              cell: (r) => (r.kind === "folder" ? count(r.items) : column.cell(r.item)),
            },
            {
              id: "updated",
              header: "Updated",
              width: 128,
              className: "text-[var(--typren-muted-fg)]",
              cell: (r) => (r.kind === "item" && r.item.savedAt ? formatDate(r.item.savedAt) : "—"),
            },
            {
              id: "kind",
              header: "Kind",
              width: 96,
              className: "text-[var(--typren-muted-fg)]",
              cell: (r) => (r.kind === "folder" ? "Folder" : saved(r.item) ? "Saved" : "Built-in"),
            },
            {
              id: "actions",
              header: <span className="sr-only">Actions</span>,
              width: 88,
              resizable: false,
              cell: (r) =>
                r.kind === "item" && (
                  <span {...stop} className="flex justify-end gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                    {actions(r.item)}
                  </span>
                ),
            },
          ] satisfies DataColumn<Row<T>>[]
        }
      />
    );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 pb-6">
        <FolderBar folder={folder} rootLabel={label} view={view} label={folderLabel} onOpenFolder={onOpenFolder} dropOn={dropOn} over={over} />
        <Loading ready={ready} className="flex-col" skeleton={view === "gallery" ? <TileGridSkeleton min="13rem" aspect="4/3" count={8} /> : <DataTableSkeleton />}>
          <div ref={slide} className="min-h-full outline-none" onClick={() => setSelected(null)} onKeyDown={onKeyDown}>
            {view === "gallery" ? around(body) : body}
          </div>
        </Loading>
      </ScrollArea>
      {open &&
        viewing &&
        viewer({
          item: open,
          index,
          count: siblings.length,
          mode: viewing.mode,
          step: (by) => {
            const next = siblings[index + by];
            if (!next) return;
            setSelected(next.id);
            setViewing({ ...viewing, id: next.id });
          },
          close: () => setViewing(null),
          open: (item) => {
            if (at(item) !== folder) onOpenFolder(at(item));
            setSelected(item.id);
            setViewing({ id: item.id, mode: "full" });
          },
        })}
    </div>
  );
}

/** The browsers' empty folder: an icon and a line saying what goes here. */
export function LibraryEmpty({ icon, children }: Readonly<{ icon: ReactNode; children: ReactNode }>) {
  return (
    <EmptyState icon={icon} title={children} />
  );
}
