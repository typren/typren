"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FilePlus2,
  LayoutPanelTop,
  LayoutTemplate,
  Trash2,
  X,
} from "lucide-react";
import type { PageTemplate, SavedSlice, Slice } from "@typren/core";
import type { AssetView } from "./asset-browser";
import { Lightbox } from "./asset-viewer";
import { titleCase } from "./collection-list";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { EmptyState } from "./primitives/empty";
import { Input } from "./primitives/input";
import { Field } from "./primitives/field";
import { LibraryBrowser, LibraryEmpty } from "./library-browser";
import { useConfirm } from "./primitives/confirm";
import { ScrollArea } from "./primitives/scroll-area";
import { AddMenu } from "./primitives/add-button";
import {
  libraryEntries,
  SlicePreview,
  useSectionRoute,
  type LibraryEntry,
} from "./sections-library";
import type { TyprenStudioHost } from "./types";

/** What a page template's slice is called in a list: its `label`, else its type. */
export const sliceName = (s: Slice) =>
  typeof s.label === "string" && s.label ? s.label : titleCase(s.slice);

/** Saved sections plus the built-in slice types, the choices for adding a
 *  section to a template or a new page. */
export function useLibraryEntries(host: TyprenStudioHost): LibraryEntry[] {
  const [saved, setSaved] = useState<SavedSlice[]>([]);
  useEffect(() => {
    let live = true;
    host.library?.list().then(
      (s) => live && setSaved(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [host.library]);
  return libraryEntries(saved, host.sliceNames, host.defaults);
}

/**
 * A page's sections stacked top to bottom, each as the site renders it (or
 * its sketch, see `SlicePreview`). Small, it is a tile showing the first few;
 * large, the whole page, scrolling; `column`, the whole page in a narrow,
 * scrolling column of tile-sized previews.
 */
export function TemplateStack({
  host,
  slices,
  large,
  column,
}: Readonly<{
  host: TyprenStudioHost;
  slices: Slice[];
  large?: boolean;
  column?: boolean;
}>) {
  const route = useSectionRoute(host.sectionPreviewUrl);
  if (!large && !column)
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center gap-1 overflow-hidden rounded-[var(--typren-radius-control)] bg-[var(--typren-card-bg)] px-[22%] py-2 ring-1 ring-[var(--typren-stroke-card)]">
        {slices.length === 0 ? (
          <span className="m-auto text-xs text-[var(--typren-muted-fg)]">
            No sections
          </span>
        ) : (
          // ponytail: one frame per shown slice, capped at 4 a tile.
          slices
            .slice(0, 4)
            .map((s, i) => (
              <SlicePreview
                key={i}
                base={route}
                slice={s}
                schema={host.fieldSchema?.[s.slice]}
              />
            ))
        )}
      </div>
    );
  return (
    <ScrollArea
      onClick={(e) => e.stopPropagation()}
      className={cn("max-h-full w-full", column ? "max-w-sm" : "max-w-3xl")}
      viewportClassName="h-auto max-h-[inherit]"
    >
      <div className="flex flex-col gap-3">
        {slices.length === 0 ? (
          <EmptyState icon={<LayoutPanelTop />} title="No sections yet. Add some from the panel." />
        ) : (
          slices.map((s, i) => (
            <SlicePreview
              key={i}
              base={route}
              slice={s}
              schema={host.fieldSchema?.[s.slice]}
              large={large}
            />
          ))
        )}
      </div>
    </ScrollArea>
  );
}

/** An ordered list of slices to reorder, remove and add to from `choices`. */
export function SliceListEditor({
  slices,
  choices,
  onChange,
}: Readonly<{
  slices: Slice[];
  choices: LibraryEntry[];
  onChange: (next: Slice[]) => void;
}>) {
  const move = (i: number, by: number) => {
    const next = [...slices];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {slices.length > 0 && (
        <ol aria-label="Sections" className="flex flex-col gap-1">
          {slices.map((s, i) => (
            <li
              key={i}
              className="flex h-10 items-center gap-1 rounded-[var(--typren-radius-control)] py-1 pr-1 pl-2 ring-1 ring-[var(--typren-stroke-card)]"
            >
              <span className="w-5 shrink-0 text-xs tabular-nums text-[var(--typren-muted-fg)]">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {sliceName(s)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="typren-concentric"
                aria-label={`Move ${sliceName(s)} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="typren-concentric"
                aria-label={`Move ${sliceName(s)} down`}
                disabled={i === slices.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="typren-concentric"
                aria-label={`Remove ${sliceName(s)}`}
                onClick={() => onChange(slices.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <AddMenu
        labelled
        label="Add section"
        options={choices.map((c) => ({ value: c.id, label: c.name }))}
        onPick={(id) => {
          const picked = choices.find((c) => c.id === id);
          if (picked) onChange([...slices, structuredClone(picked.slice)]);
        }}
      />
    </div>
  );
}

const NEW_ID = "new:template";
type TemplateEntry = {
  id: string;
  name: string;
  slices: Slice[];
  savedAt?: string;
  folder?: string;
};

/** The viewer's right panel: the template's name and sections, editable,
 *  saved back with the savedAt conflict check. */
function TemplatePanel({
  host,
  entry,
  draft,
  onChange,
  onSaved,
  onDelete,
  onNewPage,
}: Readonly<{
  host: TyprenStudioHost;
  entry: TemplateEntry;
  draft: { name: string; slices: Slice[] };
  onChange: (next: { name: string; slices: Slice[] }) => void;
  onSaved: (saved?: PageTemplate) => void;
  onDelete?: () => void;
  onNewPage?: (template: PageTemplate) => void;
}>) {
  const templates = host.library?.templates;
  const choices = useLibraryEntries(host);
  const [status, setStatus] = useState("");
  const edited =
    draft.name !== entry.name ||
    JSON.stringify(draft.slices) !== JSON.stringify(entry.slices);
  const heading = (text: string) => (
    <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--typren-muted-fg)]">
      {text}
    </h2>
  );
  const save = async () => {
    if (!templates) return;
    setStatus("Saving…");
    try {
      if (!entry.savedAt) {
        const saved = await templates.save(draft.name, draft.slices);
        setStatus("");
        onSaved(saved);
        return;
      }
      const result = await templates.update(
        entry.id,
        draft.slices,
        entry.savedAt,
        draft.name,
      );
      setStatus(
        result.ok
          ? "Saved"
          : result.code === "conflict"
            ? "This template changed elsewhere since you opened it. Save again to replace that version with yours."
            : "This template was deleted.",
      );
      onSaved();
    } catch (e) {
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <>
      <section className="flex flex-col gap-3">
        <Field label="Name" htmlFor="typren-template-name">
          <Input
            id="typren-template-name"
            value={draft.name}
            placeholder="Landing page"
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </Field>
        {heading("Sections")}
        <SliceListEditor
          slices={draft.slices}
          choices={choices}
          onChange={(slices) => onChange({ ...draft, slices })}
        />
      </section>
      <section className="flex flex-col gap-2">
        <Button
          variant="outline"
          disabled={entry.savedAt ? !edited : !draft.name.trim()}
          onClick={() => void save()}
        >
          {entry.savedAt ? "Save changes" : "Save as new template"}
        </Button>
        {entry.savedAt && onNewPage && (
          <Button
            onClick={() =>
              onNewPage({
                id: entry.id,
                name: draft.name,
                savedAt: entry.savedAt!,
                slices: draft.slices,
              })
            }
          >
            <FilePlus2 /> New page from template
          </Button>
        )}
        {entry.savedAt && onDelete && (
          <Button variant="destructive" onClick={onDelete}>
            <Trash2 /> Delete template
          </Button>
        )}
        {status && (
          <p role="status" className="text-sm text-[var(--typren-muted-fg)]">
            {status}
          </p>
        )}
      </section>
    </>
  );
}

/** Drag payload type for a page template's id. */
export const TEMPLATE_DRAG_TYPE = "application/x-typren-template";

/**
 * Templates → Pages: saved page templates in their folders, plus a blank
 * one at the top level to start a new template from, browsed like Assets
 * (see `LibraryBrowser`). The viewer edits a template's name and sections
 * and starts a new page from it. `rev` and `onChange` as `SectionsLibrary`'s.
 */
export function PageTemplatesLibrary({
  host,
  view,
  folder = "",
  rev,
  onOpenFolder = () => {},
  onChange,
  onNewPage,
}: Readonly<{
  host: TyprenStudioHost;
  view: AssetView;
  folder?: string;
  rev?: number;
  onOpenFolder?: (folder: string) => void;
  onChange?: () => void;
  /** Opens the new-page wizard with `template` chosen. */
  onNewPage?: (template: PageTemplate) => void;
}>) {
  const templates = host.library?.templates;
  const [data, setData] = useState<{ saved: PageTemplate[]; folders?: string[] } | null>(null);
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<{
    id: string;
    name: string;
    slices: Slice[];
  } | null>(null);
  const load = () =>
    templates &&
    Promise.all([templates.list(), templates.folders?.list()]).then(
      ([saved, folders]) => setData({ saved, folders }),
      () => {
        setStatus("Couldn’t load page templates.");
        setData((d) => d ?? { saved: [] });
      },
    );
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, rev]);
  const changed = () => (onChange ? onChange() : void load());
  const run = (fn: () => Promise<unknown>, failure: string) =>
    fn().then(
      () => (setStatus(""), changed()),
      () => (setStatus(failure), changed()),
    );

  const entries: TemplateEntry[] = [
    { id: NEW_ID, name: "New template", slices: [] },
    ...(data?.saved ?? []),
  ];
  const remove = async (e: TemplateEntry, close?: () => void) => {
    if (!templates || !e.savedAt) return;
    if (
      !(await confirm({
        title: "Delete template?",
        description: `Delete the page template “${e.name}”?`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    close?.();
    void run(() => templates.remove(e.id), "Delete failed");
  };
  const count = (e: TemplateEntry) =>
    `${e.slices.length} section${e.slices.length === 1 ? "" : "s"}`;

  if (!templates)
    return (
      <EmptyState icon={<LayoutTemplate />} title="This studio has no page templates." />
    );
  const folders = templates.folders;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {status && (
        <p role="alert" className="px-6 pt-4 text-xs text-[var(--typren-destructive)]">
          {status}
        </p>
      )}
      <LibraryBrowser<TemplateEntry>
        label="Page templates"
        items={entries}
        folders={data?.folders}
        folder={folder}
        view={view}
        ready={!!data}
        dragType={TEMPLATE_DRAG_TYPE}
        thumb={(e) =>
          e.savedAt ? (
            <TemplateStack host={host} slices={e.slices} />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center rounded-[var(--typren-radius-control)] border border-dashed border-[var(--typren-stroke-card)] text-[var(--typren-muted-fg)]">
              <LayoutTemplate className="size-6" aria-hidden />
            </div>
          )
        }
        icon={<LayoutTemplate />}
        meta={(e) => (e.savedAt ? count(e) : "Start here")}
        column={{ header: "Sections", cell: (e) => (e.savedAt ? count(e) : "") }}
        empty={
          <LibraryEmpty icon={<LayoutTemplate />}>
            Save a template here with Move, or drag one onto this folder.
          </LibraryEmpty>
        }
        onOpenFolder={onOpenFolder}
        onRename={(e, name) =>
          void run(
            () => templates.update(e.id, e.slices, e.savedAt!, name),
            "Rename failed",
          )
        }
        onMove={
          templates.move &&
          ((e, to) =>
            void run(() => templates.move!(e.id, to, e.savedAt), "Move failed"))
        }
        onDelete={(e) => void remove(e)}
        onRenameFolder={
          folders &&
          ((f, to) =>
            void run(() => folders.rename(f, to), "Rename failed").then(
              () => folder === f && onOpenFolder(to),
            ))
        }
        onDeleteFolder={
          folders &&
          ((f) => void run(() => folders.delete(f), "Delete failed"))
        }
        viewer={({ item: open, index, count: total, mode, step, close, open: show }) => {
          const shown =
            draft?.id === open.id
              ? draft
              : {
                  id: open.id,
                  name: open.savedAt ? open.name : "",
                  slices: open.slices,
                };
          return (
            <Lightbox
              title={open.name}
              mode={mode}
              index={index}
              count={total}
              noun="template"
              onStep={step}
              onClose={close}
              panel={
                <TemplatePanel
                  key={open.id}
                  host={host}
                  entry={open}
                  draft={shown}
                  onChange={(next) => setDraft({ id: open.id, ...next })}
                  onDelete={() => void remove(open, close)}
                  onNewPage={onNewPage}
                  onSaved={(saved) => {
                    changed();
                    if (!saved) return;
                    // The new template opens in place of the blank one.
                    setDraft(null);
                    setData((d) => ({ ...d, saved: [...(d?.saved ?? []), saved] }));
                    show(saved);
                  }}
                />
              }
            >
              <TemplateStack host={host} slices={shown.slices} large />
            </Lightbox>
          );
        }}
      />
      {dialog}
    </div>
  );
}
