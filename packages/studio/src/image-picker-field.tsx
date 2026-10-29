"use client";

import { useState } from "react";
import type { FieldFormMedia, MediaAsset } from "@typren/core";
import { MediaGrid } from "./media-grid";
import { useMediaUrl } from "./media-url";
import { Button } from "./primitives/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./primitives/dialog";
import { Input } from "./primitives/input";

export type { FieldFormMedia };

/** A single image-valued field, styled like a normal CMS media control: a
 *  thumbnail with Replace / Remove when set, or an "Add image" dropzone-button
 *  when empty, no raw path shown. Both open a Base UI Dialog media library
 *  (focus trap, ESC and backdrop included). When no `media` library is configured the
 *  field degrades to a plain path input (the "it's just a string" escape hatch
 *  for external URLs). */
export function ImagePickerField({
  value,
  onChange,
  media,
  label,
}: Readonly<{
  value: string;
  onChange: (url: string) => void;
  media?: FieldFormMedia;
  /** The field's name, so Replace and Remove tell two pickers apart. */
  label?: string;
}>) {
  const resolve = useMediaUrl();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const openLibrary = async () => {
    if (!media) return;
    setAssets(await media.list());
    setOpen(true);
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
            src={resolve(value)}
            alt=""
            loading="lazy"
            className="h-24 w-full rounded-[var(--typren-radius-control)] border border-[var(--typren-border)] bg-[var(--typren-bg)] object-contain p-1"
          />
          <div className="flex gap-2">
            {media && (
              <Button type="button" variant="outline" size="sm" aria-label={label ? `Replace ${label}` : undefined} onClick={openLibrary}>
                Replace
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" aria-label={label ? `Remove ${label}` : undefined} onClick={() => onChange("")}>
              Remove
            </Button>
          </div>
        </div>
      ) : media ? (
        <Button
          type="button"
          variant="outline"
          onClick={openLibrary}
          className="h-24 w-full border-dashed text-[var(--typren-fg)]"
        >
          + Add image
        </Button>
      ) : (
        // No media library configured. Fall back to the raw path escape hatch.
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/img/…" />
      )}

      {media && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle className="sr-only">Media library</DialogTitle>
            <MediaGrid
              assets={filtered}
              mode="picker"
              query={query}
              onQueryChange={setQuery}
              onSelect={(asset) => {
                onChange(asset.url);
                setOpen(false);
              }}
              onUploadFiles={upload}
              busy={busy}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
