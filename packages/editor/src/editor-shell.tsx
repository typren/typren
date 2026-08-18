"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun, TriangleAlert } from "lucide-react";
import type { PageActions, PageContent, PageInfo, Slice, SliceSchema } from "@typren/core";
import { BlockList } from "./block-list";
import { DevicePreview } from "./device-preview";
import { FieldForm } from "./field-form";
import type { FieldFormMedia } from "./image-picker-field";
import type { FieldFormIcons } from "./icon-picker-field";
import { PagesNav } from "./pages-nav";
import { useT } from "./intl";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";

/**
 * Linear-style visual editor: a left nav (pages + this page's block outline),
 * a device-switchable live-preview center, and a right property panel. Edits
 * autosave to the draft and refresh the preview; Publish promotes it, Discard
 * drops it. Blocks are also click-selectable on the canvas.
 *
 * No routing inside this component: it never touches `window.location` for
 * navigation. `onNavigate`/`onReload` report intents; the host (which owns the
 * router) decides what they mean for its URLs.
 */
export function EditorShell({
  slug,
  pages,
  initialPage,
  initialVersion,
  sliceNames,
  defaults,
  fieldSchema,
  previewPath,
  actions,
  media,
  icons,
  locale,
  onNavigate,
  onReload,
}: Readonly<{
  slug: string;
  pages: PageInfo[];
  initialPage: PageContent;
  /** Content version the editor loaded; sent on every write for optimistic
   *  locking (null when the page has no content yet). */
  initialVersion: string | null;
  sliceNames: string[];
  defaults: Record<string, Record<string, unknown>>;
  fieldSchema?: Record<string, SliceSchema>;
  previewPath: string;
  actions: PageActions;
  /** Wires FieldForm's "image" control to the media library. Omit to disable
   *  media management (image fields degrade to plain text inputs). */
  media?: FieldFormMedia;
  /** Wires FieldForm's "icon" control. Omit to degrade to a plain text input. */
  icons?: FieldFormIcons;
  /** Content locale for reads/writes (single-locale hosts omit this). */
  locale?: string;
  /** A page slug to open, or `null` for the page picker, e.g. after create/delete. */
  onNavigate: (slug: string | null) => void;
  /** Refresh whatever the host considers "this page" after a discard/publish/
   *  conflict-reload (a full reload, a router refresh, a refetch): the host's
   *  call, not this package's. */
  onReload: () => void;
}>) {
  const t = useT();
  const [page, setPage] = useState<PageContent>(initialPage);
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  // Version of the content this editor is based on, and whether a concurrent
  // write has been detected (someone else changed the page under us).
  const [version, setVersion] = useState<string | null>(initialVersion);
  const [conflict, setConflict] = useState(false);
  const [previewV, setPreviewV] = useState(0);
  const [dark, setDark] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("typren-theme") === "dark"
  );
  const firstRender = useRef(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("typren-theme", dark ? "dark" : "light");
  }, [dark]);

  // Debounced autosave + preview refresh ~0.8s after edits settle.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Stop the autosave loop once a conflict is showing. Don't keep retrying a
    // write we already know will lose until the author resolves it.
    if (!dirty || conflict) return;
    const tmr = setTimeout(async () => {
      const res = await actions.saveDraft(slug, page, version ?? undefined, locale);
      if (res.ok) {
        setVersion(res.version);
        setDirty(false);
        setStatus(t("shell.draftSaved"));
        setPreviewV((v) => v + 1);
      } else {
        setConflict(true);
        setStatus("");
      }
    }, 800);
    return () => clearTimeout(tmr);
  }, [page, dirty, slug, actions, version, conflict, locale, t]);

  // Messages from the preview iframe: block selection + inline text edits.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.__typren !== true) return;
      if (d.type === "select" && typeof d.index === "number") {
        setSelected(d.index);
      }
      if (d.type === "edit" && typeof d.index === "number") {
        // Map the edited on-canvas text back to the slice's matching string
        // field (by comparing plain text, ignoring **markdown** markers).
        const before = String(d.before ?? "").trim();
        setPage((p) => {
          const slices = [...p.slices];
          const s = { ...slices[d.index] };
          const key = Object.keys(s).find(
            (k) => k !== "slice" && typeof s[k] === "string" && String(s[k]).replaceAll("**", "").trim() === before
          );
          if (!key) return p;
          s[key] = String(d.after ?? "");
          slices[d.index] = s;
          return { ...p, slices };
        });
        setSelected(d.index);
        setDirty(true);
        setStatus("");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Sidebar selection -> scroll the matching block into view in the preview.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { __typren: true, type: "select", index: selected },
      window.location.origin
    );
  }, [selected, previewV]);

  const mutate = (slices: Slice[], nextSelected = selected) => {
    setPage((p) => ({ ...p, slices }));
    setSelected(Math.max(0, Math.min(nextSelected, slices.length - 1)));
    setDirty(true);
    setStatus("");
  };

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= page.slices.length) return;
    const next = [...page.slices];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    mutate(next, to);
  };
  const add = (name: string) =>
    mutate([...page.slices, { slice: name, ...(defaults[name] ?? {}) }], page.slices.length);
  const duplicate = (i: number) => {
    const next = [...page.slices];
    next.splice(i + 1, 0, { ...page.slices[i] });
    mutate(next, i + 1);
  };
  const remove = (i: number) => mutate(page.slices.filter((_, j) => j !== i), Math.max(0, i - 1));
  const updateSelected = (next: Slice) =>
    mutate(page.slices.map((s, j) => (j === selected ? next : s)));

  const publish = async () => {
    setBusy(true);
    setStatus(t("shell.publishing"));
    try {
      // Save at our version first; if that already conflicts, don't publish.
      const saved = await actions.saveDraft(slug, page, version ?? undefined, locale);
      if (!saved.ok) {
        setConflict(true);
        setStatus("");
        return;
      }
      setVersion(saved.version);
      const pub = await actions.publish(slug, saved.version, locale);
      if (!pub.ok) {
        setConflict(true);
        setStatus("");
        return;
      }
      onReload();
    } catch (e) {
      setStatus(t("shell.publishFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!confirm(t("shell.confirmDiscard"))) return;
    setBusy(true);
    setStatus(`${t("shell.discardDraft")}…`);
    try {
      await actions.discardDraft(slug, locale);
      onReload();
    } catch (e) {
      setStatus(`${t("shell.discardDraft")} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Conflict resolution. Reload takes the other editor's version (losing local
  // unsaved edits); Overwrite blind-writes our version (baseVersion omitted).
  const overwrite = async () => {
    setBusy(true);
    setStatus(t("shell.overwriting"));
    try {
      const res = await actions.saveDraft(slug, page, undefined, locale);
      if (res.ok) {
        setVersion(res.version);
        setConflict(false);
        setDirty(false);
        setStatus(t("shell.draftSaved"));
        setPreviewV((v) => v + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const previewSrc = `${previewPath}/${slug}?v=${previewV}${locale ? `&locale=${locale}` : ""}`;

  return (
    <div className={cn("fixed inset-0 z-[100] flex bg-[var(--typren-bg)] text-[var(--typren-fg)]", dark && "dark")}>
      <PagesNav pages={pages} currentSlug={slug} onCreate={actions.createPage} onDelete={actions.deletePage} onNavigate={onNavigate}>
        <BlockList
          slices={page.slices}
          selectedIndex={selected}
          sliceNames={sliceNames}
          onSelect={setSelected}
          onReorder={reorder}
          onAdd={add}
          onDuplicate={duplicate}
          onDelete={remove}
        />
      </PagesNav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--typren-border)] px-4 py-2">
          <span className="font-mono text-sm font-semibold">/{slug}</span>
          <span className="text-xs text-[var(--typren-muted-fg)]">
            {dirty ? t("shell.unsaved") : status || t("shell.upToDate")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("shell.toggleTheme")}
              onClick={() => setDark((v) => !v)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={discard}>
              {t("shell.discardDraft")}
            </Button>
            <Button size="sm" disabled={busy || conflict} onClick={publish}>
              {t("shell.publish")}
            </Button>
          </div>
        </header>

        {conflict && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 border-b border-[var(--typren-border)] bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]"
          >
            <TriangleAlert className="size-4 shrink-0 text-[var(--typren-destructive)]" aria-hidden />
            <span className="min-w-0 flex-1">{t("shell.conflict")}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={onReload}>
                {t("shell.reload")}
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={overwrite}>
                {t("shell.overwrite")}
              </Button>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <DevicePreview src={previewSrc} reloadKey={previewV} iframeRef={iframeRef} />

          <aside className="w-80 shrink-0 overflow-y-auto border-l border-[var(--typren-border)]">
            <div className="border-b border-[var(--typren-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--typren-muted-fg)]">
              {t("shell.properties")}
            </div>
            <div className="p-3">
              {page.slices[selected] ? (
                <FieldForm
                  key={selected}
                  slice={page.slices[selected]}
                  schema={fieldSchema?.[page.slices[selected].slice]}
                  onChange={updateSelected}
                  media={media}
                  icons={icons}
                />
              ) : (
                <p className="text-sm text-[var(--typren-muted-fg)]">{t("shell.selectBlock")}</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
