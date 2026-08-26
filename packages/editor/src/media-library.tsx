"use client";

import { useEffect, useState } from "react";
import type { MediaAsset } from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import { MediaGrid } from "./media-grid";
import { useT } from "./intl";

/**
 * The Media section's body: standalone browse/upload/delete over `MediaGrid`
 * (the same grid `ImagePickerField`'s in-dialog picker uses — one asset-grid
 * UI for both). Embedded directly in `SectionShell`'s region: no `PagesNav`
 * of its own (the shell's `SectionNav` rail is the one left nav now) and no
 * fixed-overlay positioning, just a flex child that fills the region.
 */
export function MediaLibrarySection({ media }: Readonly<{ media?: FieldFormMedia }>) {
  const t = useT();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!media) return;
    media.list().then(setAssets);
    // Mount-only fetch — `media` is a stable RPC reference for the lifetime
    // of this section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!media) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center text-sm text-[var(--typren-muted-fg)]">
        Media library isn’t configured for this site.
      </div>
    );
  }

  const upload = async (files: FileList) => {
    setBusy(true);
    setStatus(t("media.uploading"));
    let failedError = "";
    // Sequential — avoids the fs adapter's random-suffix writes racing each
    // other for no benefit (see media.md's upload pipeline).
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(media.uploadPath, { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        failedError = err?.error ?? res.statusText;
      }
    }
    setAssets(await media.list());
    setStatus(failedError ? t("media.uploadFailed", { error: failedError }) : "");
    setBusy(false);
  };

  const remove = async (id: string) => {
    const asset = assets.find((a) => a.id === id);
    if (!confirm(t("media.confirmDelete", { name: asset?.name ?? id }))) return;
    setAssets((prev) => prev.filter((a) => a.id !== id)); // optimistic
    try {
      await media.delete(id);
    } catch {
      setAssets(await media.list()); // roll back on failure
    }
  };

  const filtered = assets.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--typren-border)] px-4 py-2">
        <span className="text-sm font-semibold">{t("media.title")}</span>
        <span className="text-xs text-[var(--typren-muted-fg)]">{status}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <MediaGrid
          assets={filtered}
          mode="library"
          query={query}
          onQueryChange={setQuery}
          onDelete={remove}
          onUploadFiles={upload}
          busy={busy}
        />
      </div>
    </div>
  );
}
