"use client";

import { useEffect, useState } from "react";
import type { CollectionRecordInfo, CollectionSection, PageActions, Slice } from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import type { FieldFormIcons } from "./icon-picker-field";
import { CollectionList, resolveListColumns } from "./collection-list";
import { FieldForm } from "./field-form";
import { useT } from "./intl";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";
import { Label } from "./primitives/label";

export type CollectionMode = "list" | "create" | "edit";

/**
 * The Collection section's body: list (`CollectionList`) + a create/edit form
 * built from `FieldForm` verbatim, same `.slice`/`.schema`/`media`/`icons`
 * wiring `EditorShell`'s properties panel uses. CRUD routes entirely through
 * the section's own `PageActions` (core's `buildCollectionActions`): list is
 * server-fed via `records` (no client "read" action, same reload-driven data
 * flow the Pages picker already uses), create = `createPage(title)` then a
 * follow-up write to correct the primary field, save = `saveDraft`+`publish`
 * in one step (no author-facing two-step draft UX for a data record), delete
 * = `deletePage`. Ported from meditor's `<meditor-collection>`.
 *
 * `actions` is optional: without it (host declared the section but wired no
 * write actions — see `TyprenEditorHost.collections`) the list still renders
 * from `records`, but create/edit/delete are disabled rather than throwing.
 *
 * `mode`/`selectedSlug` are optionally controlled, same doctrine as
 * `PageList`/`PagesNav`'s `onNavigate`: pass both plus `onNavigate` and the
 * host's own state (e.g. a `?record=<slug>&mode=<edit|create>` URL) drives
 * which record is open, so it survives a reload or a bookmark. Omit all
 * three and the panel keeps today's internal `useState` (uncontrolled,
 * no host wiring required).
 */
export function CollectionPanel({
  section,
  actions,
  records,
  media,
  icons,
  locale,
  onReload,
  mode: modeProp,
  selectedSlug: selectedSlugProp,
  onNavigate,
}: Readonly<{
  section: CollectionSection;
  actions?: PageActions;
  records: CollectionRecordInfo[];
  media?: FieldFormMedia;
  icons?: FieldFormIcons;
  locale?: string;
  onReload: () => void;
  mode?: CollectionMode;
  selectedSlug?: string;
  /** Reports list/create/edit transitions (New, a row click, cancel/back) so
   *  a host can reflect them in its own URL. See the doc comment above. */
  onNavigate?: (mode: CollectionMode, slug?: string) => void;
}>) {
  const t = useT();
  const [internalMode, setInternalMode] = useState<CollectionMode>("list");
  const [internalSlug, setInternalSlug] = useState<string>();
  const mode = modeProp ?? internalMode;
  const selectedSlug = selectedSlugProp ?? internalSlug;
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  // Always updates the internal fallback too, so a host that never passes
  // `mode`/`selectedSlug` keeps working unchanged.
  const navigate = (nextMode: CollectionMode, slug?: string) => {
    setInternalMode(nextMode);
    setInternalSlug(slug);
    onNavigate?.(nextMode, slug);
  };

  // Loads the selected record's fields into the edit form. Keyed on
  // `mode`/`selectedSlug` only (not `records`): a controlled host landing
  // directly on `?record=<slug>&mode=edit` needs this to run on mount, but a
  // reload triggered mid-edit (`onReload` after save) must not stomp
  // in-progress field changes just because `records` got a new reference.
  useEffect(() => {
    if (mode !== "edit" || !selectedSlug) return;
    const record = records.find((r) => r.slug === selectedSlug);
    if (!record) return;
    setMeta(record.meta);
    setBody(record.body);
    setDirty(false);
    setStatus("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedSlug]);

  const startCreate = () => {
    navigate("create");
    setNewTitle("");
    setStatus("");
  };

  const submitCreate = async () => {
    const value = newTitle.trim();
    if (!value || !actions) return;
    setBusy(true);
    setStatus("Creating…");
    try {
      const slug = await actions.createPage(value, locale);
      // createPage always seeds meta.title; correct it to the collection's
      // actual primary field (may not be "title", e.g. an Authors collection
      // keyed on "name") with a follow-up write.
      const { primary } = resolveListColumns(section.schema, section.titleField);
      if (primary) {
        await actions.saveDraft(slug, { meta: { [primary]: value }, slices: [], body: "" }, undefined, locale);
        await actions.publish(slug, undefined, locale);
      }
      onReload();
    } catch (e) {
      setBusy(false);
      setStatus(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const openEdit = (slug: string) => {
    if (!records.some((r) => r.slug === slug)) return;
    navigate("edit", slug);
  };

  const back = () => {
    if (dirty && !confirm(t("collection.confirmDiscard"))) return;
    navigate("list");
    setStatus("");
  };

  const onFieldChange = (next: Slice) => {
    const { slice: _drop, ...rest } = next;
    void _drop;
    setMeta(rest);
    setDirty(true);
    setStatus("");
  };

  const save = async () => {
    if (!selectedSlug || !actions) return;
    setBusy(true);
    setStatus("Saving…");
    try {
      await actions.saveDraft(selectedSlug, { meta, slices: [], body }, undefined, locale);
      await actions.publish(selectedSlug, undefined, locale);
      onReload();
    } catch (e) {
      setBusy(false);
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (slug: string) => {
    if (!actions) return;
    await actions.deletePage(slug);
    onReload();
  };

  if (mode === "create") {
    const { primary } = resolveListColumns(section.schema, section.titleField);
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--typren-border)] px-4 py-2">
          <span className="text-sm font-semibold">{t("collection.new", { label: section.label })}</span>
          <span className="text-xs text-[var(--typren-muted-fg)]">{status}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => navigate("list")}>
              {t("collection.cancel")}
            </Button>
          </div>
        </header>
        <div className="mx-auto w-full max-w-2xl p-6">
          <Label htmlFor="collection-new-title">{primary ?? "Title"}</Label>
          <div className="flex gap-2">
            <Input
              id="collection-new-title"
              autoFocus
              value={newTitle}
              disabled={busy}
              placeholder={primary ?? "Title"}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCreate()}
            />
            <Button disabled={busy || !newTitle.trim()} onClick={submitCreate}>
              {t("collection.create")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "edit") {
    const asSlice: Slice = { slice: section.label, ...meta };
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--typren-border)] px-4 py-2">
          <span className="text-sm font-semibold">{section.label}</span>
          <span className="text-xs text-[var(--typren-muted-fg)]">
            {dirty ? t("shell.unsaved") : status || t("shell.upToDate")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={back}>
              {t("collection.back")}
            </Button>
            <Button size="sm" disabled={busy || !dirty || !actions} onClick={save}>
              {t("collection.save")}
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            <FieldForm slice={asSlice} schema={section.schema} onChange={onFieldChange} media={media} icons={icons} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--typren-border)] px-4 py-2">
        <span className="text-sm font-semibold">{section.label}</span>
        <div className="ml-auto">
          <Button size="sm" disabled={!actions} onClick={startCreate}>
            {t("collection.new", { label: section.label })}
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CollectionList
          records={records}
          schema={section.schema}
          titleField={section.titleField}
          columns={section.columns}
          onSelect={openEdit}
          onDelete={actions ? remove : undefined}
        />
      </div>
    </div>
  );
}
