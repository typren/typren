"use client";

import { useEffect, useState } from "react";
import { ImageOff, Upload } from "lucide-react";
import type { MediaAsset, MediaUse } from "@typren/core";
import { UsageList, totalUses } from "./asset-viewer";
import { ASSET_DRAG_TYPE, AssetBrowser, type AssetView, type Subfolder } from "./asset-browser";
import { FolderBar } from "./folder-bar";
import type { FieldFormMedia } from "./image-picker-field";
import { useT } from "./intl";
import { cn } from "./primitives/cn";
import { useConfirm } from "./primitives/confirm";
import { folderDrop } from "./primitives/sortable";
import { EmptyState } from "./primitives/empty";
import { ScrollArea } from "./primitives/scroll-area";
import { Loading, TileGridSkeleton } from "./primitives/skeleton";
import { DataTableSkeleton } from "./primitives/data-table";

/** Uploads `files` into `folder` one at a time (the fs adapter's random-suffix
 *  writes gain nothing from racing). Resolves to the last error, or "". */
export async function uploadAssets(media: FieldFormMedia, files: FileList, folder = ""): Promise<string> {
  let failed = "";
  for (const file of Array.from(files)) {
    if (media.upload) {
      failed = await media.upload(file, folder || undefined).then(
        () => failed,
        (e: unknown) => (e instanceof Error ? e.message : String(e))
      );
      continue;
    }
    const body = new FormData();
    body.append("file", file);
    if (folder) body.append("folder", folder);
    const res = await fetch(media.uploadPath, { method: "POST", body });
    if (!res.ok) failed = (await res.json().catch(() => null))?.error ?? res.statusText;
  }
  return failed;
}

/**
 * The Assets section's main area: the folder being browsed, as a gallery or
 * a list. The shell owns the asset and folder lists (the rail shows them
 * too), so this only renders them and reports changes through `onChange`.
 */
export function MediaLibrarySection({
  media,
  assets = [],
  folders,
  folder = "",
  view = "gallery",
  ready = true,
  onOpenFolder = () => {},
  onOpenPage,
  onChange = () => {},
}: Readonly<{
  media?: FieldFormMedia;
  assets?: MediaAsset[];
  /** Every folder; undefined when the adapter has none. */
  folders?: string[];
  /** The folder shown ("" for All Assets). */
  folder?: string;
  view?: AssetView;
  /** False until the lists first load: a skeleton holds their place. */
  ready?: boolean;
  onOpenFolder?: (folder: string) => void;
  /** Opens a page an asset is used on ("settings" for site settings). */
  onOpenPage?: (slug: string) => void;
  /** Reloads the shell's lists after a change. */
  onChange?: () => Promise<void> | void;
}>) {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState("");
  const [usage, setUsage] = useState<Record<string, MediaUse[]>>();
  const [over, setOver] = useState<string | null>(null);
  const [filesOver, setFilesOver] = useState(false);
  const usageOf = media?.usage;

  useEffect(() => {
    if (!usageOf) return;
    let live = true;
    usageOf()
      .then((next) => live && setUsage(next))
      .catch(() => live && setUsage(undefined));
    return () => {
      live = false;
    };
  }, [usageOf, assets]);

  if (!media) {
    return (
      <EmptyState icon={<ImageOff />} title="Media library isn’t configured for this site." />
    );
  }

  const run = async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
      setStatus("");
    } catch {
      setStatus(failure);
    }
    await onChange();
  };
  const parentOf = (id: string) => assets.find((a) => a.id === id)?.folder ?? "";
  const shown = folders ? assets.filter((a) => (a.folder ?? "") === folder) : assets;
  const subfolders: Subfolder[] = (folders ?? [])
    .filter((f) => f.slice(0, Math.max(0, f.lastIndexOf("/"))) === folder)
    .map((f) => ({
      folder: f,
      size: assets.filter((a) => a.folder === f || a.folder?.startsWith(`${f}/`)).reduce((n, a) => n + a.size, 0),
      items:
        assets.filter((a) => a.folder === f).length +
        (folders ?? []).filter((g) => g.slice(0, Math.max(0, g.lastIndexOf("/"))) === f).length,
    }));
  const upload = async (files: FileList, to = folder) => {
    setStatus(t("media.uploading"));
    const error = await uploadAssets(media, files, to);
    setStatus(error ? t("media.uploadFailed", { error }) : "");
    await onChange();
  };
  const move = media.folders && ((id: string, to: string) => void run(() => media.folders!.move(id, to), "Move failed"));
  const parent = (f: string) => f.slice(0, Math.max(0, f.lastIndexOf("/")));

  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col"
      onDragEnter={(e) => e.dataTransfer.types.includes("Files") && setFilesOver(true)}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node | null) || setFilesOver(false)}
      onDropCapture={() => setFilesOver(false)}
    >
      <EmptyState
        aria-hidden
        icon={<Upload />}
        title={`Drop to upload to ${folder ? folder.slice(folder.lastIndexOf("/") + 1) : "All Assets"}`}
        className={cn(
          "pointer-events-none absolute inset-2 z-20 flex-none rounded-[var(--typren-radius-control)] border-2 border-dashed border-[var(--typren-ring)] bg-[var(--typren-card)]/85 transition-opacity duration-150 motion-reduce:transition-none",
          filesOver ? "opacity-100" : "opacity-0"
        )}
      />
      {status && <p role="alert" className="px-6 pt-4 text-xs text-[var(--typren-destructive)]">{status}</p>}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 pb-6">
        <FolderBar
          folder={folder}
          rootLabel="All Assets"
          view={view}
          onOpenFolder={onOpenFolder}
          dropOn={(f) => folderDrop(f, { onMove: move, onFiles: (files) => void upload(files, f), setOver, type: ASSET_DRAG_TYPE })}
          over={over}
        />
        <Loading ready={ready} className="flex-col" skeleton={view === "gallery" ? <TileGridSkeleton min="9rem" aspect="square" count={12} /> : <DataTableSkeleton />}>
          <AssetBrowser
            assets={shown}
            subfolders={subfolders}
            view={view}
            folders={folders && ["", ...folders]}
            usage={usage}
            onOpenFolder={onOpenFolder}
            onOpenPage={onOpenPage}
            onUploadFiles={(files, to) => void upload(files, to)}
            onDelete={async (id) => {
              const asset = assets.find((a) => a.id === id);
              const name = asset?.name ?? id;
              const uses = (asset && usage?.[asset.url]) ?? [];
              // The usage map is the loaded one; core still refuses an in-use delete
              // it was not told to force, so a page that began using the asset
              // since surfaces as a failed delete instead of a dangling image.
              const ok = await confirm({
                title: "Delete asset?",
                confirmLabel: uses.length > 0 ? "Delete anyway" : "Delete",
                destructive: true,
                description: (
                  <>
                    <p>{t("media.confirmDelete", { name })}</p>
                    {uses.length > 0 && (
                      <div className="mt-3 text-left">
                        <p className="mb-1 font-medium text-[var(--typren-fg)]">
                          In use {totalUses(uses)} {totalUses(uses) === 1 ? "time" : "times"}; those spots will lose the image:
                        </p>
                        <UsageList uses={uses} />
                      </div>
                    )}
                  </>
                ),
              });
              if (ok) void run(() => (uses.length > 0 ? media.delete(id, { force: true }) : media.delete(id)), "Delete failed");
            }}
            onMove={move}
            onRename={media.folders && ((id, name) => void run(() => media.folders!.move(id, parentOf(id), name), "Rename failed"))}
            onRenameFolder={
              media.folders &&
              ((f, name) => {
                const to = parent(f) ? `${parent(f)}/${name}` : name;
                void run(() => media.folders!.rename(f, to), "Rename failed").then(() => folder === f && onOpenFolder(to));
              })
            }
            onDeleteFolder={media.folders && ((f) => void run(() => media.folders!.delete(f), "Delete failed"))}
          />
        </Loading>
      </ScrollArea>
      {dialog}
    </div>
  );
}
