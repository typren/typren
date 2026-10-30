"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { FieldFormMedia, MediaAsset } from "@typren/core";
import { MediaGrid } from "./media-grid";
import { useMediaUrl } from "./media-url";
import { Button } from "./primitives/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./primitives/dialog";
import { Input } from "./primitives/input";
import { ToggleGroup, ToggleGroupItem } from "./primitives/toggle-group";

export type { FieldFormMedia };

type SharedMedia = { label: string; list(): Promise<MediaAsset[]> };
// A context, not a prop: FieldForm is reached through several panels, and the
// shared source is host-wide like the site origin.
const SharedMediaContext = createContext<SharedMedia | undefined>(undefined);

export function SharedMediaProvider({ value, children }: Readonly<{ value?: SharedMedia; children: ReactNode }>) {
  return <SharedMediaContext.Provider value={value}>{children}</SharedMediaContext.Provider>;
}

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
  const shared = useContext(SharedMediaContext);
  const [source, setSource] = useState<"site" | "shared">("site");
  const [sharedAssets, setSharedAssets] = useState<MediaAsset[]>([]);
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const openLibrary = async () => {
    if (!media) return;
    setSource("site");
    setAssets(await media.list());
    setOpen(true);
  };

  const pickSource = async (next: "site" | "shared") => {
    if (next === "shared") setSharedAssets(await shared!.list());
    setSource(next);
  };

  const upload = async (files: FileList) => {
    if (!media) return;
    setBusy(true);
    try {
      // Sequential: avoids the fs adapter's random-suffix writes racing each
      // other for no benefit.
      for (const file of Array.from(files)) {
        if (media.upload) {
          await media.upload(file);
          continue;
        }
        const body = new FormData();
        body.append("file", file);
        await fetch(media.uploadPath, { method: "POST", body });
      }
      setAssets(await media.list());
    } finally {
      setBusy(false);
    }
  };

  const shownAssets = source === "shared" ? sharedAssets : assets;
  const filtered = shownAssets.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

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
            {shared && (
              <ToggleGroup
                aria-label="Media source"
                value={[source]}
                onValueChange={(v) => v[0] && void pickSource(v[0] as "site" | "shared")}
              >
                <ToggleGroupItem value="site" className="w-auto px-3">
                  Site
                </ToggleGroupItem>
                <ToggleGroupItem value="shared" className="w-auto px-3">
                  {shared.label}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
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
              readOnly={source === "shared"}
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
