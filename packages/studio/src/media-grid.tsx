"use client";

import { useRef } from "react";
import { Copy, ImageOff, Trash2, Upload } from "lucide-react";
import type { MediaAsset } from "@typren/core";
import { Button } from "./primitives/button";
import { SearchInput } from "./primitives/search-input";
import { useMediaUrl } from "./media-url";

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Shared presentational grid, used both standalone (media library page) and
 *  inside the picker dialog. `assets` is expected pre-filtered by the caller
 *  (over the already-fetched full list). This component only displays
 *  `query`/`onQueryChange`, it doesn't filter itself. */
export function MediaGrid({
  assets,
  mode,
  query,
  onQueryChange,
  onSelect,
  onDelete,
  onUploadFiles,
  busy = false,
}: Readonly<{
  assets: MediaAsset[];
  mode: "library" | "picker";
  /** Omit both to drop the search box (the Assets section relies on the
   *  studio's universal search instead). */
  query?: string;
  onQueryChange?: (q: string) => void;
  onSelect?: (asset: MediaAsset) => void; // picker mode
  onDelete?: (id: string) => void; // library mode
  onUploadFiles: (files: FileList) => void; // both: drag/drop + file-picker upload
  busy?: boolean;
}>) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) onUploadFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2">
        {onQueryChange ? (
          <SearchInput
            className="flex-1"
            aria-label="Search media"
            placeholder="Search media…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        ) : (
          <div className="flex-1" />
        )}
        <label className="sr-only" htmlFor="media-upload-input">
          Upload images
        </label>
        <input
          id="media-upload-input"
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload /> Upload
        </Button>
      </div>

      {assets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-[var(--typren-muted-fg)]">
          <ImageOff className="size-6" aria-hidden />
          Drop images here, or use Upload.
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {assets.map((a) => (
            <li key={a.id}>
              {mode === "picker" ? (
                <button
                  type="button"
                  onClick={() => onSelect?.(a)}
                  className="block w-full cursor-pointer overflow-hidden rounded-[var(--typren-radius-control)] transition-colors duration-150 motion-reduce:transition-none border border-[var(--typren-border)] text-left hover:border-[var(--typren-ring)]"
                >
                  <Thumb asset={a} />
                </button>
              ) : (
                <div className="overflow-hidden rounded-[var(--typren-radius-control)] border border-[var(--typren-border)] [--typren-inset:5px]">
                  <Thumb asset={a} />
                  <div className="flex items-center justify-between gap-1 p-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="typren-concentric"
                      aria-label={`Copy ${a.name} URL`}
                      onClick={() => navigator.clipboard.writeText(a.url)}
                    >
                      <Copy />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      className="typren-concentric"
                      aria-label={`Delete ${a.name}`}
                      onClick={() => onDelete?.(a.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thumb({ asset }: Readonly<{ asset: MediaAsset }>) {
  const resolve = useMediaUrl();
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element -- content-authored path has no static-import metadata next/image needs */}
      <img src={resolve(asset.url)} alt={asset.name} loading="lazy" className="aspect-square w-full object-cover" />
      <div className="truncate px-1.5 py-1 text-xs text-[var(--typren-fg)]">{asset.name}</div>
      <div className="px-1.5 pb-1 text-[10px] text-[var(--typren-muted-fg)]">{humanSize(asset.size)}</div>
    </div>
  );
}
