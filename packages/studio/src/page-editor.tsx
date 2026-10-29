"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { TriangleAlert, X } from "lucide-react";
import type { PageContent, Slice } from "@typren/core";
import { BlockList } from "./block-list";
import { CanvasOverlay, toRects, toScroll, type PageScroll, type SliceRect } from "./canvas-overlay";
import { fromFrame, postToFrame } from "./device-preview";
import { FieldForm } from "./field-form";
import type { Frame, PillPage } from "./frame";
import { useT } from "./intl";
import type { LocaleSwitch } from "./locale-select";
import { useConfirm } from "./primitives/confirm";
import { Button } from "./primitives/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./primitives/dialog";
import { ReviewButton, useReviewGate } from "./review-panel";
import { SaveStatus, useAutosave } from "./save-status";
import type { TyprenStudioHost } from "./types";

/**
 * Edit mode (rail level 2): the page's slices in the rail, Save / Discard /
 * Publish in the action bar, and the canvas overlay over the preview, whose
 * toolbar holds the selected slice's `FieldForm` in a popover. Save writes
 * the draft and reloads the preview; Discard drops it after a confirm;
 * Publish opens a dialog listing every page with pending changes and
 * publishes them all on confirm.
 *
 * With `host.git` (the local studio) edits autosave to the draft, Save
 * publishes this page, which the host commits, and Publish becomes Review,
 * which asks the shell to open its Review panel (`onReview`); `gitRev` moves
 * when that panel pushed or discarded, so what is pending is fetched again.
 *
 * A hook, not a component: the shell keeps one Frame and one preview frame
 * across browse and edit mode, and edit mode fills that Frame's slots
 * (`frame`), draws over its preview (`overlay`) and adds its dialogs. While
 * disabled it returns null. Entering edit mode, or another slug, locale or
 * host version, starts over from `initialPage`; leaving drops the local copy
 * of the page. `leave` asks before dropping unsaved changes, then calls
 * `onExit`.
 */
export function usePageEditor({
  enabled,
  host,
  slug,
  pill,
  otherDrafts = [],
  initialPage,
  initialVersion,
  locale,
  iframeRef,
  onReloadPreview,
  onExit,
  onReload,
  localeSwitch,
  onReview,
  gitRev = 0,
}: Readonly<{
  enabled: boolean;
  host: TyprenStudioHost;
  slug: string;
  pill: Omit<PillPage, "status"> & { hasDraft: boolean };
  /** Other pages with an unpublished draft; Publish lists and publishes them with this one. */
  otherDrafts?: { slug: string; title: string }[];
  initialPage: PageContent;
  initialVersion: string | null;
  locale?: string;
  /** The shell's preview frame, which this mode's overlay draws over. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Reloads the preview frame to show what was just written. */
  onReloadPreview: () => void;
  /** Back to browse mode (rail level 1). */
  onExit: () => void;
  onReload: () => void;
  localeSwitch?: LocaleSwitch;
  /** Local studio: opens the shell's Review panel. */
  onReview?: () => void;
  /** Moves after the Review panel pushed or discarded. */
  gitRev?: number;
}>): {
  frame: Pick<
    ComponentProps<typeof Frame>,
    "title" | "level" | "back" | "localeSwitch" | "pill" | "toolbar" | "banner" | "rail"
  >;
  leave: () => void;
  /** Saves what is left; asks before dropping edits that could not save.
   *  True to go ahead. For anything that moves off this page without
   *  `leave` (a search pick). */
  confirmLeave: () => Promise<boolean>;
  overlay: ReactNode;
  dialogs: ReactNode;
  /** The page as edited so far, for the persistent canvas to show. */
  page: PageContent;
  /** This page has a saved draft or edits about to save. */
  drafted: boolean;
} | null {
  const t = useT();
  const { actions, sliceNames, defaults, fieldSchema, media, icons, git } = host;
  const local = Boolean(git);
  const [page, setPage] = useState<PageContent>(initialPage);
  const [selected, setSelected] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // Autosave, on every host: there is no Save button.
  const auto = useAutosave({
    enabled,
    version: initialVersion,
    drafted: pill.hasDraft,
    write: (base) => actions.saveDraft(slug, page, base, locale),
    onSaved: onReloadPreview,
  });
  const { dirty, drafted, version, conflict, error: saveError } = auto;
  const [dialog, setDialog] = useState<"publish" | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rects, setRects] = useState<SliceRect[]>([]);
  const [scroll, setScroll] = useState<PageScroll>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // Overlay popups portal here, inside the Frame, so they keep its `.dark` scope.
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  // Each edit session starts from the host's copy (React's "adjust state
  // when a prop changes" pattern, so no stale frame of the old page shows).
  const session = enabled ? `${slug}\n${locale}\n${initialVersion}` : null;
  const [shownSession, setShownSession] = useState(session);
  if (session !== shownSession) {
    setShownSession(session);
    setPage(initialPage);
    setSelected(0);
    setFormOpen(false);
    auto.reset(initialVersion, pill.hasDraft);
    setBusy(false);
    setStatus("");
    setDialog(null);
    setRects([]);
    setScroll(null);
    setHovered(null);
  }

  const { flush, edit: markEdit } = auto;

  // Messages from the preview iframe: overlay geometry, slice selection and inline text edits.
  useEffect(() => {
    if (!enabled) return;
    const onMessage = (e: MessageEvent) => {
      // A same-origin preview frame is sandboxed into an opaque origin (see DevicePreview), so its
      // messages arrive with origin "null", which any other sandboxed frame can claim too. The sender's
      // WindowProxy cannot be forged, so the frame is identified by source, and by origin too, since
      // the source stays the same when the frame navigates elsewhere.
      if (!fromFrame(e, iframeRef.current)) return;
      const d = e.data;
      if (!d || d.__typren !== true) return;
      if (d.type === "rects") {
        // In page coordinates when the bridge says where it had scrolled to.
        const at = toScroll(d);
        setScroll(at);
        setRects(toRects(d.rects).map((r) => (at ? { ...r, top: r.top + at.y, left: r.left + at.x } : r)));
      }
      if (d.type === "hover" && (d.index === null || Number.isInteger(d.index))) setHovered(d.index);
      if (!Number.isInteger(d.index)) return;
      // Selecting on the canvas only moves the overlay; Edit section opens the form.
      if (d.type === "select") setSelected(d.index);
      if (d.type === "edit") {
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
        markEdit();
        setStatus("");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, iframeRef, markEdit]);

  // A changed selection scrolls the matching slice into view. Entering edit
  // mode is no change: the page stays where the visitor had scrolled it.
  const shownSelected = useRef<number | null>(null);
  useEffect(() => {
    const was = shownSelected.current;
    shownSelected.current = enabled ? selected : null;
    if (enabled && was !== null && was !== selected)
      postToFrame(iframeRef.current, { __typren: true, type: "select", index: selected });
  }, [enabled, selected, iframeRef]);

  const mutate = (slices: Slice[], nextSelected = selected) => {
    setPage((p) => ({ ...p, slices }));
    setSelected(Math.max(0, Math.min(nextSelected, slices.length - 1)));
    auto.edit();
    setStatus("");
  };
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= page.slices.length) return;
    const next = [...page.slices];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    mutate(next, to);
  };
  const insert = (at: number, name: string) => {
    const next = [...page.slices];
    next.splice(at, 0, { slice: name, ...(defaults[name] ?? {}) });
    mutate(next, at);
  };
  const duplicate = (i: number) => {
    const next = [...page.slices];
    next.splice(i + 1, 0, { ...page.slices[i] });
    mutate(next, i + 1);
  };
  const remove = (i: number) => mutate(page.slices.filter((_, j) => j !== i), Math.max(0, i - 1));
  const updateSelected = (next: Slice) => mutate(page.slices.map((s, j) => (j === selected ? next : s)));

  // True once it is safe to move off this page: every edit saved (a write
  // in flight is waited for, never dropped), or, when saving failed, the
  // viewer said to drop what did not save.
  const confirmLeave = async () =>
    (await flush()) ||
    confirm({
      title: "Leave without your latest edits?",
      description: "They couldn’t be saved and will be lost.",
      confirmLabel: "Leave",
      destructive: true,
    });
  const leave = async () => {
    // Nothing to save: it leaves at once, without waiting a microtask.
    if ((!dirty && !auto.busy) || (await confirmLeave())) onExit();
  };

  const pending = dirty || drafted;
  const hasPending = pending || otherDrafts.length > 0;

  // Review needs something saved to send: a draft here or on another page,
  // or saved files from before (media, settings) not pushed yet.
  const { noBranch, reason: reviewReason } = useReviewGate(git, enabled, gitRev, pending || otherDrafts.length > 0);
  const gitProblem = saveError || noBranch;

  const publish = async () => {
    setBusy(true);
    setStatus(t("shell.publishing"));
    try {
      if (pending) {
        // This page first, at our version: a lost race stops before the rest.
        const res = await actions.commitPage(slug, dirty ? page : undefined, version ?? undefined, locale);
        if (!res.ok) {
          auto.setConflict(true);
          setStatus("");
          return;
        }
      }
      // ponytail: other pages publish without a baseVersion (last write wins); they are not open here.
      await actions.publishAll(locale);
      setDialog(null);
      onReload();
    } catch (e) {
      setStatus(t("shell.publishFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const askDiscard = async () => {
    const ok = await confirm({
      title: "Discard changes?",
      description: `${dirty ? "Unsaved edits and the saved draft" : "The saved draft"} will be dropped and the page reverts to its ${local ? "last saved" : "published"} version.`,
      confirmLabel: "Discard",
      destructive: true,
    });
    if (ok) await discard();
  };
  const discard = async () => {
    setBusy(true);
    setStatus(`${t("shell.discardDraft")}…`);
    try {
      if (drafted) await actions.discardDraft(slug, locale);
      onExit();
      onReload();
      onReloadPreview();
    } catch (e) {
      setStatus(`${t("shell.discardDraft")} failed: ${e instanceof Error ? e.message : String(e)}`);
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
        auto.saved(res.version);
        onReloadPreview();
      }
    } finally {
      setBusy(false);
    }
  };

  const slice = page.slices[selected];
  // The open form pins the overlay to the slice it edits; otherwise it follows the pointer.
  const active = formOpen ? selected : (hovered ?? selected);

  // The bridge draws the outlines in the page, in the studio's accent; sent
  // again with each new geometry, which is also how a reloaded frame hears it.
  useEffect(() => {
    const frame = iframeRef.current;
    if (!enabled || !frame) return;
    const color = getComputedStyle(frame).getPropertyValue("--typren-primary").trim() || undefined;
    postToFrame(frame, { __typren: true, type: "outline", active, selected, color });
  }, [enabled, active, selected, rects, iframeRef]);
  const select = (i: number) => {
    setSelected(i);
    setHovered(null);
  };

  if (!enabled) return null;
  return {
    page,
    drafted: pending,
    leave,
    confirmLeave,
    frame: {
      title: pill.title,
      level: 2,
      back: { label: t("nav.pages"), onBack: leave },
      localeSwitch: localeSwitch && {
        ...localeSwitch,
        // The other locale's content replaces this editor's copy.
        onChange: async (l) => {
          if (await confirmLeave()) localeSwitch.onChange(l);
        },
      },
      pill: {
        title: pill.title,
        url: pill.url,
        status: status || (drafted || dirty ? (local ? "Not pushed" : "Unpublished changes") : local ? "Pushed" : "Published"),
      },
      toolbar: (
        <>
          {local ? (
            <ReviewButton
              reason={reviewReason}
              disabled={busy}
              portal={portal}
              onClick={async () => {
                // Review lists saved drafts, so the latest edits go in first.
                await flush();
                onReview?.();
              }}
            />
          ) : (
            <>
              {/* Discard stays on hosts without Review, the only place to drop a draft there. */}
              {pending && (
                <Button variant="destructive" disabled={busy} onClick={askDiscard}>
                  Discard
                </Button>
              )}
              {hasPending && (
                <Button disabled={busy || conflict} onClick={() => setDialog("publish")}>
                  {t("shell.publish")}
                </Button>
              )}
            </>
          )}
          {/* The status sits at the bar's edge, after what can be done. */}
          <SaveStatus
            {...auto.status}
            history={git?.history && (() => git.history!(slug, locale))}
            portal={portal}
          />
        </>
      ),
      banner: (
        conflict ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]"
          >
            <TriangleAlert className="size-4 shrink-0 text-[var(--typren-destructive)]" aria-hidden />
            <span className="min-w-0 flex-1">{t("shell.conflict")}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onReload();
                  onReloadPreview();
                }}
              >
                {t("shell.reload")}
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={overwrite}>
                {t("shell.overwrite")}
              </Button>
            </div>
          </div>
        ) : (
          gitProblem && (
            <div
              role="alert"
              className="flex items-start gap-3 bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--typren-destructive)]" aria-hidden />
              <span className="grid min-w-0">
                <span className="font-medium">{saveError ? "Couldn't save your changes" : "Saving is off"}</span>
                <span>{gitProblem}</span>
              </span>
            </div>
          )
        )
      ),
      rail: (
        <div ref={railRef} className="contents">
          <BlockList
            title={pill.title}
            slices={page.slices}
            selectedIndex={selected}
            sliceNames={sliceNames}
            onSelect={(i) => {
              select(i);
              setFormOpen(true);
            }}
            onReorder={reorder}
            onAdd={(name) => insert(page.slices.length, name)}
            onDuplicate={duplicate}
            onDelete={remove}
          />
        </div>
      ),
    },
    overlay: (
      <CanvasOverlay
        rects={rects}
        scroll={scroll}
        frame={iframeRef}
        active={active}
        selected={selected}
        count={page.slices.length}
        sliceNames={sliceNames}
        portal={portal}
        formOpen={formOpen}
        onFormOpenChange={(open) => {
          if (open) select(active);
          setFormOpen(open);
        }}
        form={
          slice && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{typeof slice.label === "string" ? slice.label : slice.slice}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setFormOpen(false)}>
                  <X />
                </Button>
              </div>
              <FieldForm
                key={selected}
                slice={slice}
                schema={fieldSchema?.[slice.slice]}
                onChange={updateSelected}
                media={media}
                icons={icons}
              />
            </>
          )
        }
        onInsert={insert}
        onLayers={(i) => {
          select(i);
          // One <li> per slice in BlockList; its first button selects the row.
          railRef.current?.querySelectorAll("li")[i]?.querySelector("button")?.focus();
        }}
        onDuplicate={duplicate}
        onSave={
          host.library &&
          ((i) => {
            const s = page.slices[i]!;
            host.library!.save(typeof s.label === "string" ? s.label : s.slice, s).then(
              () => setStatus("Saved to Sections"),
              (e) => setStatus(`Save to Sections failed: ${e instanceof Error ? e.message : String(e)}`)
            );
          })
        }
        onMove={reorder}
        onRemove={remove}
      />
    ),
    dialogs: (
      <>
        {confirmDialog}
        {!local && (
          <Dialog open={dialog === "publish"} onOpenChange={(o) => !o && !busy && setDialog(null)}>
            <DialogContent>
              <DialogTitle>Publish changes</DialogTitle>
              <p className="text-[var(--typren-muted-fg)]">These pages have changes that are not live yet.</p>
              <ul className="grid gap-1">
                {[...(pending ? [{ slug, title: pill.title }] : []), ...otherDrafts].map((p) => (
                  <li key={p.slug} className="flex justify-between gap-4">
                    <span className="truncate">{p.title}</span>
                    <span className="shrink-0 text-[var(--typren-muted-fg)]">
                      {p.slug === slug && dirty ? "Unsaved edits" : "Draft"}
                    </span>
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button disabled={busy} onClick={publish}>
                  Publish
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <div ref={setPortal} className="contents" />
      </>
    ),
  };
}
