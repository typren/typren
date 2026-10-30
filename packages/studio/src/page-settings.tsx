"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Settings2 } from "lucide-react";
import { SITE_SLUG, linksTo, readMenu, slugError, type PageContent, type PageInfo, type PageMetaPatch, type RenameResult, type SaveResult, type Slice } from "@typren/core";
import { useT } from "./intl";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";
import { Label } from "./primitives/label";
import { CheckboxRow, Field } from "./primitives/field";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives/popover";
import { usePortal } from "./primitives/portal";
import { Textarea } from "./primitives/textarea";

/** Reads a page with its version and changes its settings as drafts (core's
 *  `updatePageMeta`, which also writes the page's place in the site menu). */
export type PageSettingsIO = {
  load: (slug: string) => Promise<{ page: PageContent; version: string | null }>;
  updateMeta: (slug: string, patch: PageMetaPatch, version: string | null) => Promise<SaveResult>;
  /** Omit and the slug is read-only. */
  rename?: (slug: string, to: string) => Promise<RenameResult>;
  /** Saves slices as a page template; omit for no "Save as page template". */
  saveTemplate?: (name: string, slices: Slice[]) => Promise<unknown>;
};

type Form = { title: string; slug: string; nav: boolean; noindex: boolean; description: string };

const status = (p: PageInfo) =>
  p.published === false ? "Draft, never published" : p.hasDraft ? "Published, with unpublished changes" : "Published";

/** A page's settings, in a popover on its rail row: title, slug, navigation,
 *  search visibility, description, and delete. Front-matter fields save as a
 *  draft through `io.updateMeta`, like content edits; a slug change renames the
 *  page's files at once through `io.rename`. "Show in navigation" adds or
 *  removes the page as a top-level item in the site doc's menu draft, and is
 *  read-only on a site whose menu lives in its code. Without `io` only the
 *  status, slug and delete show. */
export function PageSettings({
  page,
  home,
  siblings,
  nested,
  io,
  pending,
  triggerClassName,
  onDelete,
  onRenamed,
}: Readonly<{
  page: PageInfo;
  home: boolean;
  /** Slug segments beside this page's, for the slug check. */
  siblings: string[];
  /** The page has pages under it, which a rename would leave behind. */
  nested: boolean;
  io?: PageSettingsIO;
  pending: boolean;
  triggerClassName: string;
  onDelete: (slug: string) => void;
  onRenamed: (slug: string) => void;
}>) {
  const t = useT();
  const portal = usePortal();
  const id = useId();
  const popupRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{
    page: PageContent;
    version: string | null;
    init: Form;
    /** Whether the site doc has a menu: the toggle is read-only without one. */
    hasMenu: boolean;
  } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The inline "Save as page template" name, while it is open, and what came of it.
  const [tplName, setTplName] = useState<string | null>(null);
  const [tplNote, setTplNote] = useState("");
  const cut = page.slug.lastIndexOf("/");
  const parent = page.slug.slice(0, cut + 1);
  const segment = page.slug.slice(cut + 1);
  const slugLocked = home ? "The home page keeps its slug." : nested ? "Move the pages under it first." : "";
  const path = home ? "/" : `/${page.slug}`;
  const canRename = !!io?.rename && !slugLocked;

  // Focus waits on the popup while the page loads, then moves to Title,
  // unless the user has already moved it elsewhere.
  useEffect(() => {
    if (loaded && document.activeElement === popupRef.current) titleRef.current?.focus();
  }, [loaded]);
  const initialFocus = () => {
    if (!io) return true;
    return titleRef.current && !titleRef.current.disabled ? titleRef.current : popupRef.current;
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next || !io) return;
    setLoaded(null);
    setForm(null);
    setError("");
    setTplName(null);
    setTplNote("");
    // No site doc (a 404) or one without a menu both mean the menu is code.
    Promise.all([io.load(page.slug), io.load(SITE_SLUG).catch(() => null)]).then(
      ([r, siteDoc]) => {
        const m = r.page.meta;
        const menu = siteDoc && readMenu(siteDoc.page.meta);
        const init: Form = {
          title: typeof m.title === "string" ? m.title : page.title,
          slug: segment,
          // The menu draft when the site doc has one, else the published grouping.
          nav: menu ? linksTo(menu.nav, path) : !!page.nav,
          noindex: m.noindex === true,
          description: typeof m.description === "string" ? m.description : "",
        };
        setLoaded({ page: r.page, version: r.version, init, hasMenu: !!menu });
        setForm(init);
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };

  const slugProblem = form && form.slug !== segment ? slugError(form.slug, siblings.filter((s) => s !== segment)) : null;
  const metaChanged =
    !!form &&
    !!loaded &&
    (["title", "noindex", "description"] as const).some((k) => form[k] !== loaded.init[k]);
  const navChanged = !!form && !!loaded?.hasMenu && form.nav !== loaded.init.nav;
  const slugChanged = !!form && form.slug !== segment;
  const ready = !busy && !pending && !!form?.title.trim() && !slugProblem && (metaChanged || navChanged || slugChanged);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !form || !loaded || !io) return;
    setBusy(true);
    setError("");
    try {
      if (metaChanged || navChanged) {
        const patch: PageMetaPatch = { title: form.title, noindex: form.noindex, description: form.description };
        if (navChanged) patch.nav = form.nav;
        const res = await io.updateMeta(page.slug, patch, loaded.version);
        if (!res.ok) return setError(t("shell.conflict"));
        setLoaded({ ...loaded, version: res.version, init: { ...form, slug: segment } });
      }
      if (slugChanged && io.rename) {
        const res = await io.rename(page.slug, parent + form.slug);
        if (!res.ok) return setError("That slug is already used here.");
        onRenamed(res.slug);
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async (e: FormEvent) => {
    e.preventDefault();
    const name = tplName?.trim();
    if (!name || !loaded || !io?.saveTemplate) return;
    setBusy(true);
    setTplNote("");
    try {
      // The page as loaded: its draft when it has one, else what is published.
      await io.saveTemplate(name, loaded.page.slices);
      setTplName(null);
      setTplNote(`Saved as the page template “${name}”.`);
    } catch (err) {
      setTplNote(`Couldn’t save the template: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => f && { ...f, [k]: v });
  const field = (name: string) => `${id}-${name}`;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger aria-label={`Settings for ${page.title}`} className={triggerClassName}>
        <Settings2 className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        aria-label="Page settings"
        ref={popupRef}
        initialFocus={initialFocus}
        // The popup can take its initial focus after the page has loaded.
        onFocus={(e) => e.target === popupRef.current && loaded && titleRef.current?.focus()}
        container={portal}
        side="right"
        align="start"
        sideOffset={8}
        className="w-80 gap-0 p-0"
      >
        <form aria-label={`${page.title} settings`} onSubmit={submit} className="flex flex-col gap-3 p-(--typren-inset-card)">
          <p className="text-xs text-[var(--typren-muted-fg)]">{status(page)}</p>
          {io && (
            <Field label="Title" htmlFor={field("title")}>
              <Input
                ref={titleRef}
                id={field("title")}
                value={form?.title ?? ""}
                disabled={!form}
                onChange={(e) => set("title", e.target.value)}
              />
            </Field>
          )}
          <Field
            label="Slug"
            htmlFor={field("slug")}
            note={slugProblem ?? (io?.rename ? slugLocked : undefined)}
            error={!!slugProblem}
          >
            <div className="flex items-center gap-1 text-[15px] text-[var(--typren-muted-fg)]">
              <span className="shrink-0">/{parent}</span>
              <Input
                id={field("slug")}
                value={form?.slug ?? segment}
                readOnly={!canRename}
                disabled={canRename && !form}
                aria-invalid={slugProblem ? true : undefined}
                aria-describedby={slugProblem || slugLocked ? field("slug-note") : undefined}
                onChange={(e) => set("slug", e.target.value)}
              />
            </div>
          </Field>
          {io && (
            <>
              <CheckboxRow
                label="Show in navigation"
                note={
                  !form || loaded?.hasMenu
                    ? "Adds or removes this page as a top-level menu item. Arrange the menu in Navigation."
                    : "This site’s menu is managed in its code."
                }
                checked={form?.nav ?? false}
                disabled={!form || !loaded?.hasMenu}
                onChange={(on) => set("nav", on)}
              />
              <CheckboxRow label="Hide from search engines" checked={form?.noindex ?? false} disabled={!form} onChange={(on) => set("noindex", on)} />
              <Field label="Search description" htmlFor={field("description")}>
                <Textarea
                  id={field("description")}
                  rows={3}
                  value={form?.description ?? ""}
                  disabled={!form}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>
              {error && (
                <p role="alert" className="text-xs text-[var(--typren-destructive)]">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--typren-muted-fg)]">
                  {canRename ? "Saves as a draft. A new slug applies right away, without Publish." : "Saves as a draft."}
                </span>
                <Button type="submit" size="sm" disabled={!ready}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          )}
        </form>
        <div className="flex flex-col gap-3 border-t border-[var(--typren-border)] p-(--typren-inset-card)">
          {tplName !== null && (
            <form aria-label="Save as page template" onSubmit={saveTemplate} className="flex flex-col gap-2">
              <Label htmlFor={field("template")}>Template name</Label>
              <div className="flex gap-2">
                <Input
                  id={field("template")}
                  autoFocus
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setTplName(null))}
                />
                <Button type="submit" size="sm" disabled={busy || !tplName.trim()}>
                  Save template
                </Button>
              </div>
            </form>
          )}
          {tplNote && (
            <p role="status" className="text-xs text-[var(--typren-muted-fg)]">
              {tplNote}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-40 flex-1 text-xs text-[var(--typren-muted-fg)]">
              {home ? "The home page can't be deleted." : "Deleting can't be undone."}
            </span>
            <span className="flex gap-2">
              {io?.saveTemplate && tplName === null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!loaded || busy}
                  onClick={() => (setTplNote(""), setTplName(form?.title.trim() || page.title))}
                >
                  Save as page template
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={home || pending || busy}
                onClick={() => (setOpen(false), onDelete(page.slug))}
              >
                Delete page
              </Button>
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
