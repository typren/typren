"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CircleAlert, ExternalLink, Indent, Menu, MousePointerClick, Outdent, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { SITE_SLUG, navHrefError, readMenu, type NavItem, type PageContent, type PageInfo } from "@typren/core";
import { DevicePreview, type Device } from "./device-preview";
import { useT } from "./intl";
import { useConfirm } from "./primitives/confirm";
import { useAnnounce } from "./announce";
import { AddButton } from "./primitives/add-button";
import { PanelHeader } from "./primitives/panel-header";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { EmptyState } from "./primitives/empty";
import { Input } from "./primitives/input";
import { CheckboxRow, Field } from "./primitives/field";
import { SelectionList, rowClass } from "./primitives/selection";
import { DragHandle, useSortable, type Where } from "./primitives/sortable";
import { Loading, RowsSkeleton, Skeleton } from "./primitives/skeleton";
import { ReviewButton, useReviewGate } from "./review-panel";
import { SaveStatus, useAutosave } from "./save-status";
import type { TyprenStudioHost } from "./types";

/** Where an item sits: `[i]` at the top level, `[i, j]` in item i's submenu. */
export type NavPath = number[];

export const NAV_DOCS_URL = "https://typren.com/docs/navigation";

const lastOf = (path: NavPath) => path[path.length - 1]!;

export function itemAt(nav: NavItem[], path: NavPath): NavItem | undefined {
  return path.length === 1 ? nav[path[0]!] : nav[path[0]!]?.children?.[path[1]!];
}

/** `item` with `children`, the key dropped when there are none. */
function withChildren(item: NavItem, children: NavItem[]): NavItem {
  const { children: _drop, ...rest } = item;
  void _drop;
  return (children.length ? { ...rest, children } : rest) as NavItem;
}

/** `nav` with the list `path` sits in replaced by `fn` of it. */
function editList(nav: NavItem[], path: NavPath, fn: (list: NavItem[]) => NavItem[]): NavItem[] {
  if (path.length === 1) return fn(nav);
  return nav.map((p, i) => (i === path[0] ? withChildren(p, fn(p.children ?? [])) : p));
}

export const updateItem = (nav: NavItem[], path: NavPath, fn: (item: NavItem) => NavItem) =>
  editList(nav, path, (l) => l.map((x, k) => (k === lastOf(path) ? fn(x) : x)));

export const removeItem = (nav: NavItem[], path: NavPath) => editList(nav, path, (l) => l.filter((_, k) => k !== lastOf(path)));

export function pathOf(nav: NavItem[], item: NavItem): NavPath | null {
  for (const [i, top] of nav.entries()) {
    if (top === item) return [i];
    const j = top.children?.indexOf(item) ?? -1;
    if (j >= 0) return [i, j];
  }
  return null;
}

/**
 * `nav` with the item at `from` dropped `where` relative to the one at `to`.
 * Unchanged when the move is not allowed: menus nest one level, so an item
 * with a submenu cannot go into one, and nothing goes inside a submenu item.
 * ponytail: one level of children, the depth every site header we know
 * renders; walk paths of any length if a site needs deeper menus.
 */
export function moveItem(nav: NavItem[], from: NavPath, to: NavPath, where: Where): NavItem[] {
  const item = itemAt(nav, from);
  const target = itemAt(nav, to);
  if (!item || !target || item === target) return nav;
  const deep = where === "inside" || to.length > 1;
  if (deep && (item.children?.length || (where === "inside" && to.length > 1))) return nav;
  const rest = removeItem(nav, from);
  // Where `to` points once `from` is gone: a later sibling shifts up one.
  const at = [...to];
  const k0 = from.length - 1;
  if (k0 < at.length && from.slice(0, k0).every((n, i) => n === at[i]) && at[k0]! > from[k0]!) at[k0]!--;
  if (where === "inside") return updateItem(rest, at, (t) => withChildren(t, [...(t.children ?? []), item]));
  const k = lastOf(at) + (where === "after" ? 1 : 0);
  return editList(rest, at, (l) => [...l.slice(0, k), item, ...l.slice(k)]);
}

/** The site path an internal menu href points at, for matching a page:
 *  no query, fragment or trailing slash. Null for an external or "#" link. */
export function navTarget(item: Pick<NavItem, "href" | "external">): string | null {
  if (item.external === true || typeof item.href !== "string" || !/^\/(?!\/)/.test(item.href)) return null;
  return item.href.split(/[?#]/)[0]!.replace(/(.)\/+$/, "$1");
}

/** Why an item can't be saved, or null. */
export const itemError = (item: NavItem) =>
  typeof item.label !== "string" || !item.label.trim() ? "Enter a label." : navHrefError(typeof item.href === "string" ? item.href : "");

type Selected = NavPath | "cta" | null;
type Loaded = { page: PageContent; version: string | null; drafted: boolean };

/**
 * Navigation's draft and its lifecycle, kept by the shell so the controls sit
 * in the top bar like a page's. The site doc is a doc like any other, so this
 * goes through `host.actions` and the store's draft, version and conflict
 * flow. Edits autosave to the draft; the bar shows the save status, then
 * Review with `host.git` (the local studio, where a push commits the menu as
 * `content: update navigation`), else Discard and Publish.
 */
export function useNavDraft({
  host,
  enabled,
  locale,
  gitRev = 0,
  otherDrafts = false,
  onReload,
  onReview,
}: Readonly<{
  host: Pick<TyprenStudioHost, "actions" | "getPage" | "git">;
  /** Load only while the Navigation entry is open. */
  enabled: boolean;
  locale?: string;
  /** Moves after Review pushed or discarded, to refetch what waits. */
  gitRev?: number;
  /** Another screen has a saved draft, so Review has something to send. */
  otherDrafts?: boolean;
  onReload: () => void;
  onReview?: () => void;
}>) {
  const t = useT();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { actions, git } = host;
  const [doc, setDoc] = useState<Loaded | "none" | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadKey, setLoadKey] = useState(0);
  const [nav, setNav] = useState<NavItem[]>([]);
  const [cta, setCta] = useState<NavItem | undefined>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useAnnounce(status);
  const [previewV, setPreviewV] = useState(0);
  const [selected, setSelected] = useState<Selected>(null);

  const ready = doc !== null && doc !== "none";
  const invalid = nav.some((x) => itemError(x) || (x.children ?? []).some(itemError)) || (!!cta && !!itemError(cta));
  const page = (): PageContent => {
    const base = (doc as Loaded).page;
    return { ...base, meta: { ...base.meta, nav, ...(cta && { cta }) } };
  };
  // The site doc's draft follows edits; an invalid link holds it until fixed.
  const auto = useAutosave({
    enabled: ready && !invalid,
    version: null,
    drafted: false,
    write: (base) => actions.saveDraft(SITE_SLUG, page(), base, locale),
    onSaved: () => setPreviewV((v) => v + 1),
  });
  const { dirty, drafted, conflict } = auto;
  const gate = useReviewGate(git, enabled, gitRev, auto.status.drafted || otherDrafts);

  useEffect(() => {
    if (!enabled) return;
    if (!host.getPage) {
      setDoc("none");
      return;
    }
    let live = true;
    host.getPage(SITE_SLUG).then(
      (r) => {
        if (!live) return;
        const menu = readMenu(r.page.meta);
        setDoc(menu ? { page: r.page, version: r.version, drafted: r.hasDraft ?? false } : "none");
        setNav(menu?.nav ?? []);
        setCta(menu?.cta);
        auto.reset(r.version, r.hasDraft ?? false);
        setLoadError("");
        setPreviewV((v) => v + 1);
      },
      (e: unknown) => {
        if (!live) return;
        // A 404 is a site with no site doc; anything else is a failed read.
        if ((e as { status?: number })?.status === 404) setDoc("none");
        else setLoadError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      live = false;
    };
    // `host` is rebuilt on every host render; `loadKey` is the reload signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loadKey, locale]);
  const reload = () => setLoadKey((k) => k + 1);

  const loading = doc === null && !loadError;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      await fn();
    } catch (e) {
      setStatus(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Hosts without git: the menu goes live on Publish.
  const onPublish = () =>
    run(t("shell.publish"), async () => {
      if (!(await auto.flush())) return;
      const res = await actions.publish(SITE_SLUG, auto.base(), locale);
      if (!res.ok) {
        auto.setConflict(true);
        setStatus("");
        return;
      }
      auto.saved(res.version, false);
      setPreviewV((v) => v + 1);
      setStatus("Published");
      // The Pages rail groups by the published menu.
      onReload();
    });
  const onDiscard = async () => {
    const ok = await confirm({
      title: "Discard changes?",
      description: "Discard your navigation changes? The menu goes back to its published version.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (!ok) return;
    void run("Discard", async () => {
      await auto.flush();
      await actions.discardDraft(SITE_SLUG, locale);
      setSelected(null);
      setStatus("");
      reload();
    });
  };

  const change = (nextNav: NavItem[], nextCta = cta) => {
    setNav(nextNav);
    setCta(nextCta);
    auto.edit();
    setStatus("");
  };
  /** Moves an item and keeps it selected. */
  const move = (from: NavPath, to: NavPath, where: Where) => {
    const item = itemAt(nav, from);
    const next = moveItem(nav, from, to, where);
    if (next === nav || !item) return;
    change(next);
    setSelected(pathOf(next, item));
  };
  const add = () => {
    const next = [...nav, { label: "New link", href: "/" }];
    change(next);
    setSelected([next.length - 1]);
  };
  const remove = (path: NavPath) => {
    change(removeItem(nav, path));
    setSelected(null);
  };
  const update = (sel: Exclude<Selected, null>, patch: Partial<NavItem>) => {
    // An undefined key drops it: front matter can't hold one.
    const apply = (x: NavItem) =>
      Object.fromEntries(Object.entries({ ...x, ...patch }).filter(([, v]) => v !== undefined)) as NavItem;
    if (sel === "cta") change(nav, apply(cta!));
    else change(updateItem(nav, sel, apply));
  };
  /** Before leaving the entry: saves what is left; false when that save
   *  failed and the user keeps the edits. */
  const leave = async () => {
    const stay =
      !(await auto.flush()) &&
      !(await confirm({
        title: "Leave without your latest edits?",
        description: "They couldn’t be saved and will be lost.",
        confirmLabel: "Leave",
        destructive: true,
      }));
    if (stay) return false;
    if (dirty) reload();
    setSelected(null);
    return true;
  };

  const pending = dirty || drafted;
  const actionsNode: ReactNode = ready && (
    <>
      {git ? (
        onReview && (
          <ReviewButton
            reason={gate.reason}
            disabled={busy}
            onClick={async () => {
              await auto.flush();
              onReview();
            }}
          />
        )
      ) : (
        <>
          {pending && (
            <Button variant="destructive" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          )}
          <Button disabled={busy || conflict || invalid || !pending} onClick={onPublish}>
            {t("shell.publish")}
          </Button>
        </>
      )}
      {/* The status sits at the bar's edge, after what can be done. */}
      <SaveStatus {...auto.status} history={git?.history && (() => git.history!(SITE_SLUG, locale))} />
    </>
  );

  const banner: ReactNode = conflict ? (
    <div role="alert" className="flex flex-wrap items-center gap-3 bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]">
      <TriangleAlert className="size-4 shrink-0 text-[var(--typren-destructive)]" aria-hidden />
      <span className="min-w-0 flex-1">{t("shell.conflict")}</span>
      <Button variant="outline" size="sm" disabled={busy} onClick={reload}>
        {t("shell.reload")}
      </Button>
    </div>
  ) : (
    (auto.error || gate.noBranch) && (
      <div role="alert" className="flex items-start gap-3 bg-[var(--typren-muted)] px-4 py-2 text-sm text-[var(--typren-fg)]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--typren-destructive)]" aria-hidden />
        <span className="grid min-w-0">
          <span className="font-medium">{auto.error ? "Couldn’t save the menu" : "Saving is off"}</span>
          <span>{auto.error || gate.noBranch}</span>
        </span>
      </div>
    )
  );

  const dialog: ReactNode = (
    <>
      {confirmDialog}
    </>
  );

  return {
    doc,
    ready,
    loading,
    loadError,
    nav,
    cta,
    dirty,
    pending,
    reload,
    status: status || (pending ? (git ? "Not pushed" : "Unpublished changes") : t("shell.upToDate")),
    /** A saved draft or edits about to save. */
    drafted: auto.status.drafted,
    flush: auto.flush,
    previewV,
    selected,
    select: setSelected,
    move,
    add,
    remove,
    update,
    leave,
    actions: actionsNode,
    banner,
    dialog,
  };
}

export type NavDraft = ReturnType<typeof useNavDraft>;

type Row = { item: NavItem; path: NavPath };
const rowsOf = (nav: NavItem[]): Row[] =>
  nav.flatMap((item, i) => [{ item, path: [i] }, ...(item.children ?? []).map((c, j) => ({ item: c, path: [i, j] }))]);
const samePath = (a: Selected, b: NavPath) => Array.isArray(a) && a.length === b.length && a.every((n, k) => n === b[k]);

/** The panel and preview cards while the menu loads, at their final sizes. */
function NavPanelSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 gap-4">
      <section className={cn(CARD, "flex w-80 shrink-0 flex-col")}>
        <header className="flex items-center gap-3 border-b border-[var(--typren-stroke-divider)] px-4 py-2">
          <Skeleton className="h-5 w-20" />
        </header>
      </section>
      <Skeleton className="min-w-0 flex-1 rounded-[var(--typren-radius-card)]" />
    </div>
  );
}

/** Level 1 under Website → Navigation: the menu as a tree. Drag a row to
 *  reorder it, or onto the middle of a top-level row to nest it; Alt+Arrow
 *  steps it among its siblings, and the item's panel has every move as buttons. */
export function NavLevel({ draft }: Readonly<{ draft: NavDraft }>) {
  const toPath = (id: string) => id.split(".").map(Number);
  const sortable = useSortable({
    onMove: (from, to, where) => draft.move(toPath(from), toPath(to), where),
    nests: (id) => !id.includes("."),
    onStep: (id, by) => {
      const path = toPath(id);
      const parent = path.slice(0, -1);
      const count = parent.length ? (draft.nav[parent[0]!]?.children?.length ?? 0) : draft.nav.length;
      const k = lastOf(path) + by;
      if (k < 0 || k >= count) return null;
      const label = itemAt(draft.nav, path)?.label || "Untitled";
      draft.move(path, [...parent, k], by < 0 ? "before" : "after");
      return { to: [...parent, k].join("."), message: `${label} moved to position ${k + 1} of ${count}` };
    },
  });
  const row = ({ item, path }: Row) => {
    const { className, ...sort } = sortable(path.join("."));
    return (
      <li key={path.join(".")} {...sort} className={cn(className, "rounded-[var(--typren-radius-control)]", path.length > 1 && "ml-5")}>
        <DragHandle />
        <button
          type="button"
          aria-current={samePath(draft.selected, path) ? "page" : undefined}
          onClick={() => draft.select(path)}
          className={rowClass(samePath(draft.selected, path))}
        >
          <span className="min-w-0 flex-1 truncate">{item.label || "Untitled"}</span>
          {item.external === true && <ExternalLink className="size-3.5 shrink-0 text-[var(--typren-muted-fg)]" role="img" aria-label="External" />}
        </button>
      </li>
    );
  };
  return (
    <SelectionList>
      <PanelHeader title="Navigation">
        <AddButton label="Add menu item" onClick={draft.add} />
      </PanelHeader>
      <Loading ready={!draft.loading} skeleton={<RowsSkeleton count={5} />} className="flex-col">
      {draft.ready && (
        <>
          <ul aria-label="Menu" className="space-y-1 px-3 pb-4">
            {rowsOf(draft.nav).map(row)}
            {draft.nav.length === 0 && (
              <li>
                <EmptyState icon={<Menu />} title="No menu items yet." />
              </li>
            )}
          </ul>
          {draft.cta && (
            <div className="px-3 pb-4">
              <div className="px-3 py-1.5 text-[15px] text-[var(--typren-muted-fg)]">Button</div>
              <button
                type="button"
                aria-current={draft.selected === "cta" ? "page" : undefined}
                onClick={() => draft.select("cta")}
                className={rowClass(draft.selected === "cta")}
              >
                <span className="min-w-0 flex-1 truncate">{draft.cta.label || "Untitled"}</span>
              </button>
            </div>
          )}
        </>
      )}
      </Loading>
    </SelectionList>
  );
}

const CARD = "typren-surface-1 rounded-[var(--typren-radius-card)] border border-[var(--typren-stroke-card)] bg-[var(--typren-layer)]";

/** The selected item's fields and moves. */
function ItemPanel({ draft, pages, homeSlug }: Readonly<{ draft: NavDraft; pages: PageInfo[]; homeSlug: string }>) {
  const id = useId();
  const sel = draft.selected;
  const item = sel === "cta" ? draft.cta : sel ? itemAt(draft.nav, sel) : undefined;
  if (!sel || !item) return <EmptyState icon={<MousePointerClick />} title="Select a menu item to see its link." />;
  const href = typeof item.href === "string" ? item.href : "";
  const labelProblem = typeof item.label !== "string" || !item.label.trim() ? "Enter a label." : null;
  const hrefProblem = navHrefError(href);
  const path = sel === "cta" ? null : sel;
  const k = path ? lastOf(path) : 0;
  const siblings = path ? (path.length === 1 ? draft.nav.length : (draft.nav[path[0]!]?.children?.length ?? 0)) : 0;
  return (
    <div className="flex flex-col gap-3 p-4">
      <Field label="Label" htmlFor={`${id}-label`} note={labelProblem} error>
        <Input
          id={`${id}-label`}
          value={typeof item.label === "string" ? item.label : ""}
          aria-invalid={labelProblem ? true : undefined}
          aria-describedby={labelProblem ? `${id}-label-note` : undefined}
          onChange={(e) => draft.update(sel, { label: e.target.value })}
        />
      </Field>
      <Field label="Link" htmlFor={`${id}-href`} note={hrefProblem} error>
        <Input
          id={`${id}-href`}
          list={`${id}-pages`}
          placeholder="/about or https://"
          value={href}
          aria-invalid={hrefProblem ? true : undefined}
          aria-describedby={hrefProblem ? `${id}-href-note` : undefined}
          onChange={(e) => draft.update(sel, { href: e.target.value.trim() })}
        />
        {/* The page picker: the browser's own suggestions, typing still free. */}
        <datalist id={`${id}-pages`}>
          {pages
            .filter((p) => p.published !== false)
            .map((p) => (
              <option key={p.slug} value={p.slug === homeSlug ? "/" : `/${p.slug}`}>
                {p.title}
              </option>
            ))}
        </datalist>
      </Field>
      <CheckboxRow label="External link" checked={item.external === true} onChange={(on) => draft.update(sel, { external: on || undefined })} />
      {path && (
        <div className="flex flex-wrap gap-1 border-t border-[var(--typren-stroke-divider)] pt-3">
          <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={k === 0} onClick={() => draft.move(path, [...path.slice(0, -1), k - 1], "before")}>
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Move down"
            disabled={k === siblings - 1}
            onClick={() => draft.move(path, [...path.slice(0, -1), k + 1], "after")}
          >
            <ArrowDown />
          </Button>
          {path.length === 1 ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Move into the item above"
              disabled={k === 0 || !!item.children?.length}
              onClick={() => draft.move(path, [k - 1], "inside")}
            >
              <Indent />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Move out of the submenu" onClick={() => draft.move(path, [path[0]!], "after")}>
              <Outdent />
            </Button>
          )}
          <Button variant="destructive" size="icon-sm" className="ml-auto" aria-label="Remove item" onClick={() => draft.remove(path)}>
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Website → Navigation: the selected item's panel beside a live preview of
 * the home page, which reloads with every saved draft. A site without a menu
 * in its site doc gets an empty state pointing at the docs instead.
 */
export function NavPanel({
  draft,
  pages,
  homeSlug,
  previewSrc,
  device,
}: Readonly<{
  draft: NavDraft;
  pages: PageInfo[];
  homeSlug: string;
  previewSrc: (reloadKey: number) => string;
  device: Device;
}>) {
  if (draft.loadError)
    return (
      <EmptyState icon={<CircleAlert />} title="Couldn’t load the menu" description={draft.loadError}>
        <Button variant="outline" size="sm" className="pr-3.5 pl-2.5" onClick={draft.reload}>
          <RefreshCw aria-hidden />
          Reload
        </Button>
      </EmptyState>
    );
  if (draft.doc === "none")
    return (
      <EmptyState
        icon={<Menu />}
        title="This site’s menu is managed in its code"
        description={
          <>
            To edit it here, keep the menu as a <code>nav</code> list in the site doc and render the header from it.
          </>
        }
      >
          <a
            href={NAV_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-[var(--typren-primary)] underline-offset-4 hover:underline"
          >
            How the navigation doc works
          </a>
      </EmptyState>
    );
  return (
    <Loading ready={draft.ready} skeleton={<NavPanelSkeleton />}>
    <div className="flex min-w-0 flex-1 gap-4">
      <section aria-label="Menu item" className={cn(CARD, "flex w-80 shrink-0 flex-col")}>
        <header className="flex items-center gap-3 border-b border-[var(--typren-stroke-divider)] px-4 py-2">
          <span className="text-sm font-semibold">{draft.selected === "cta" ? "Button" : "Menu item"}</span>
          <span className="ml-auto text-xs text-[var(--typren-muted-fg)]">{draft.status}</span>
        </header>
        <ItemPanel draft={draft} pages={pages} homeSlug={homeSlug} />
      </section>
      <div className="min-w-0 flex-1">
        <DevicePreview src={previewSrc(draft.previewV)} device={device} reloadKey={draft.previewV} />
      </div>
      {draft.dialog}
    </div>
    </Loading>
  );
}
