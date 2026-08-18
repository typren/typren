"use client";

import { useRef, useState } from "react";
import type { FieldFormMedia, MediaAsset } from "@typren/core";
import { MediaGrid } from "./media-grid";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";

export type { FieldFormMedia };

/** A single image-valued field, styled like a normal CMS media control: a
 *  thumbnail with Replace / Remove when set, or an "Add image" dropzone-button
 *  when empty, no raw path shown. Both open a native `<dialog>` media library
 *  (`.showModal()` gives focus trap/ESC/backdrop from the platform for free,
 *  no headless-dialog dependency). When no `media` library is configured the
 *  field degrades to a plain path input (the "it's just a string" escape hatch
 *  for external URLs). */
export function ImagePickerField({
  value,
  onChange,
  media,
}: Readonly<{ value: string; onChange: (url: string) => void; media?: FieldFormMedia }>) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const openLibrary = async () => {
    if (!media) return;
    setAssets(await media.list());
    dialogRef.current?.showModal();
  };

  const upload = async (files: FileList) => {
    if (!media) return;
    setBusy(true);
    try {
      // Sequential: avoids the fs adapter's random-suffix writes racing each
      // other for no benefit.
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        await fetch(media.uploadPath, { method: "POST", body });
      }
      setAssets(await media.list());
    } finally {
      setBusy(false);
    }
  };

  const filtered = assets.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-2">
      {value ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- content-authored path has no static-import metadata next/image needs */}
          <img
            src={value}
            alt=""
            loading="lazy"
            className="h-24 w-full rounded-md border border-[var(--typren-border)] bg-[var(--typren-bg)] object-contain p-1"
          />
          <div className="flex gap-2">
            {media && (
              <Button type="button" variant="outline" size="sm" onClick={openLibrary}>
                Replace
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
              Remove
            </Button>
          </div>
        </div>
      ) : media ? (
        <button
          type="button"
          onClick={openLibrary}
          className="flex h-24 w-full items-center justify-center rounded-md border border-dashed border-[var(--typren-border)] text-sm text-[var(--typren-fg)] opacity-70 transition hover:border-[var(--typren-fg)] hover:opacity-100"
        >
          + Add image
        </button>
      ) : (
        // No media library configured. Fall back to the raw path escape hatch.
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/img/…" />
      )}

      {/* `m-auto` below is load-bearing: a modal <dialog> is centred by the UA
          stylesheet via `margin: auto`, and Tailwind Preflight resets every
          margin to 0. Without it the picker opens hard against the top-left
          corner. `backdrop:` dims the page so it reads as modal. */}
      {media && (
        <dialog
          ref={dialogRef}
          className="m-auto w-[min(90vw,720px)] rounded-lg border border-[var(--typren-border)] bg-[var(--typren-bg)] p-4 text-[var(--typren-fg)] backdrop:bg-black/30"
        >
          <MediaGrid
            assets={filtered}
            mode="picker"
            query={query}
            onQueryChange={setQuery}
            onSelect={(asset) => {
              onChange(asset.url);
              dialogRef.current?.close();
            }}
            onUploadFiles={upload}
            busy={busy}
          />
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => dialogRef.current?.close()}>
              Close
            </Button>
          </div>
        </dialog>
      )}
    </div>
  );
}
