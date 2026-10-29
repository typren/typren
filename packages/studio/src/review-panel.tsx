"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CloudOff, Copy, GitBranch, RefreshCw, Undo2, Upload } from "lucide-react";
import { GIT_NO_BRANCH, SITE_SLUG, type GitOutgoing, type GitPendingChange } from "@typren/core";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { useConfirm } from "./primitives/confirm";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./primitives/dialog";
import { EmptyState } from "./primitives/empty";
import { CheckboxRow } from "./primitives/field";
import { PHONE, useMediaQuery } from "./primitives/media-query";
import { ScrollArea } from "./primitives/scroll-area";
import { rowClass } from "./primitives/selection";
import { Loading, RowsSkeleton } from "./primitives/skeleton";
import { Sheet, SheetContent } from "./primitives/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./primitives/tooltip";
import type { TyprenStudioHost } from "./types";
import { useT } from "./intl";

/** What a pending file is, in the studio's words: the page's title, the
 *  site-wide docs by role, a media file by name. `path` is repo-relative;
 *  a page is matched by the longest slug its path ends in, so a deleted page
 *  (no longer listed) falls back to its file name. */
export function reviewLabel(path: string, pages: readonly { slug: string; title: string }[]): string {
  const parts = path.split("/");
  const name = parts[parts.length - 1]!;
  const stem = name.replace(/\.md$/, "");
  if (name === "typren.config.json") return "Site configuration";
  // Style lives in the settings doc, so it is "Site settings" too.
  if (parts.includes(".typren")) return stem === "settings" ? "Site settings" : stem === "library" ? "Sections library" : stem;
  if (!name.endsWith(".md")) return name;
  if (stem === SITE_SLUG) return "Navigation";
  const page = pages
    .filter((p) => path === `${p.slug}.md` || path.endsWith(`/${p.slug}.md`))
    .reduce<{ slug: string; title: string } | undefined>((best, p) => (best && best.slug.length >= p.slug.length ? best : p), undefined);
  return page?.title || stem;
}

/** The settings doc's draft among Review's draft rows: not a page slug, so
 *  it can't collide with one. Pushed with `git.push(…, true)`. */
export const SETTINGS_DRAFT = ":settings";

/**
 * What Review's button needs, for any screen: why it is off, if it is.
 * `drafted` says the screen knows of a saved draft; files saved before (media,
 * settings) and not pushed count too, refetched whenever `gitRev` moves.
 */
export function useReviewGate(git: TyprenStudioHost["git"], enabled: boolean, gitRev: number, drafted: boolean) {
  const t = useT();
  const [outgoing, setOutgoing] = useState<GitOutgoing | null>(null);
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!enabled || !git) return;
    git.outgoing().then(setOutgoing, () => setOutgoing(null));
    git.pending().then(
      (p) => setWaiting(p.length),
      () => setWaiting(0)
    );
    // `git` is rebuilt on every host render; `gitRev` is the refetch signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, Boolean(git), gitRev]);
  const noBranch = outgoing?.branch === "" ? GIT_NO_BRANCH : "";
  return { noBranch, reason: noBranch || (drafted || waiting > 0 ? "" : t("shell.nothingToReview")) };
}

/** The edit bar's Review: off, with its `reason` in a tooltip, until there
 *  is something saved to send. The trigger is a focusable wrapper, since a
 *  disabled button takes neither focus nor pointer. */
export function ReviewButton({
  reason,
  disabled,
  portal,
  onClick,
}: Readonly<{ reason: string; disabled?: boolean; portal?: HTMLElement | null; onClick: () => void }>) {
  const button = (
    <Button disabled={disabled || Boolean(reason)} onClick={onClick}>
      Review
    </Button>
  );
  if (!reason) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} aria-label={`Review: ${reason}`} className="inline-flex rounded-[var(--typren-radius-control)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent container={portal}>{reason}</TooltipContent>
    </Tooltip>
  );
}

const KIND = { added: "Added", modified: "Modified", deleted: "Deleted" } as const;
const draftItem = (p: Draft): Item => ({
  key: `draft:${p.slug}`,
  label: p.title || p.slug,
  detail: p.detail ?? `/${p.slug}`,
  kind: "Draft",
  slug: p.slug,
});
const fileItem = (c: GitPendingChange, label: string): Item => ({
  key: c.path,
  label,
  detail: c.path,
  note: c.commits.map((m) => m.subject).join(" · ") || undefined,
  kind: KIND[c.change],
  path: c.path,
});
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A saved draft: a page's, the menu's (`SITE_SLUG`) or the settings doc's
 *  (`SETTINGS_DRAFT`). `detail` replaces the page path under its title. */
export type Draft = { slug: string; title: string; detail?: string };

/** One Review row: a page's saved draft, or a saved file. */
type Item = { key: string; label: string; detail: string; note?: string; kind: string; slug?: string; path?: string };

/**
 * The local studio's Review: every page with a saved draft, then every saved
 * file the upstream lacks, one row each with a checkbox, pushed or discarded
 * by selection or one at a time. A push sends each page as one commit.
 * A Dialog on desktop, a large bottom Sheet on a phone. It loads on open and
 * again after each action; a failure shows core's plain-language reason
 * inline and keeps the selection. `onChanged` follows a successful action,
 * `discarded` when files on disk changed with it.
 */
export function ReviewPanel({
  git,
  pages,
  drafts,
  onDiscardDraft,
  open,
  note,
  onClose,
  onChanged,
}: Readonly<{
  git: NonNullable<TyprenStudioHost["git"]>;
  pages: readonly { slug: string; title: string }[];
  /** Saved drafts, read on open. */
  drafts?: () => Promise<readonly Draft[]>;
  /** Drops a draft. */
  onDiscardDraft?: (slug: string) => Promise<void>;
  open: boolean;
  /** A line such as "unsaved changes are not included". */
  note?: ReactNode;
  onClose: () => void;
  onChanged: (discarded: boolean) => void;
}>) {
  const phone = useMediaQuery(PHONE);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [list, setList] = useState<Item[] | null>(null);
  const [outgoing, setOutgoing] = useState<GitOutgoing | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  // Drafts pushed or discarded while open: `drafts` may still list them until
  // the host has read its pages again.
  const done = useRef(new Set<string>());

  // `keep` narrows the selection to the files still listed; without it all are picked.
  const load = async (keep?: ReadonlySet<string>) => {
    try {
      const [o, p, d] = await Promise.all([git.outgoing(), git.pending(), drafts?.().catch(() => []) ?? []]);
      const items = [...d.map(draftItem).filter((c) => !done.current.has(c.key)), ...p.map((c) => fileItem(c, label(c.path)))];
      setOutgoing(o);
      setList(items);
      setError(null);
      setPicked(new Set(items.map((c) => c.key).filter((k) => !keep || keep.has(k))));
    } catch (e) {
      setList((l) => l ?? []);
      setError({ title: "Couldn’t load your changes", text: message(e) });
    }
  };
  useEffect(() => {
    if (!open) return;
    done.current.clear();
    setList(null);
    setError(null);
    void load();
    // `git` is rebuilt on every host render; opening is the load signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label = (path: string) => reviewLabel(path, pages);
  const run = async (kind: "push" | "discard", keys: string[]) => {
    const items = (list ?? []).filter((c) => keys.includes(c.key));
    const slugs = items.flatMap((c) => (c.slug ? [c.slug] : []));
    const paths = items.flatMap((c) => (c.path ? [c.path] : []));
    if (
      kind === "discard" &&
      !(await confirm({
        title: items.length === 1 ? `Discard ${items[0]!.label}?` : `Discard ${items.length} changes?`,
        description: [
          slugs.length ? "Drafts are dropped." : "",
          paths.length
            ? `Saved files go back to the version already pushed${outgoing?.upstream ? ` to ${outgoing.upstream}` : ""}, in a new commit that restores them, so your history keeps the change.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: "Discard",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "push") {
        const pages = slugs.filter((s) => s !== SETTINGS_DRAFT);
        if (pages.length < slugs.length) await git.push(paths, pages, true);
        else await git.push(paths, slugs);
      }
      else {
        for (const slug of slugs) await onDiscardDraft?.(slug);
        if (paths.length) await git.discard(paths);
      }
      for (const c of items) if (c.slug) done.current.add(c.key);
      onChanged(kind === "discard");
      await load(new Set([...picked].filter((p) => !keys.includes(p))));
    } catch (e) {
      setError({ title: kind === "push" ? "Couldn’t push" : "Couldn’t discard", text: message(e) });
    } finally {
      setBusy(false);
    }
  };

  const all = list ?? [];
  const chosen = all.filter((c) => picked.has(c.key)).map((c) => c.key);
  const toggle = (path: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  // GitOutgoing carries no remote name; origin is git's own default.
  const pushOnce = outgoing?.branch && `git push -u origin ${outgoing.branch}`;
  const blocked =
    outgoing &&
    (!outgoing.branch
      ? { icon: <GitBranch />, title: "Saving is off", text: GIT_NO_BRANCH }
      : !outgoing.upstream && {
          icon: <CloudOff />,
          title: "Nowhere to push",
          text: `The branch ${outgoing.branch} has no upstream yet. Push it once from a terminal:`,
          command: pushOnce,
        });
  const rows = !blocked && all.length > 0;

  const selectAll = rows && (
    <CheckboxRow
      label={`Select all (${chosen.length} of ${all.length})`}
      checked={chosen.length === all.length}
      indeterminate={chosen.length > 0 && chosen.length < all.length}
      disabled={busy}
      onChange={(on) => setPicked(new Set(on ? all.map((c) => c.key) : []))}
    />
  );

  const body = (
    <Loading ready={list !== null} skeleton={<RowsSkeleton count={3} />} className="flex-col">
      {blocked ? (
        <EmptyState icon={blocked.icon} title={blocked.title} description={blocked.text}>
          {"command" in blocked && blocked.command && <CopyCommand command={blocked.command} />}
        </EmptyState>
      ) : !all.length ? (
        !error && (
          <EmptyState icon={<CircleCheck />} title="Nothing waiting to push" description="Saved changes show here until they are pushed.">
            <Button variant="outline" size="sm" className="pr-3.5 pl-2.5" onClick={() => void load()}>
              <RefreshCw aria-hidden />
              Refresh
            </Button>
          </EmptyState>
        )
      ) : (
        <ul className="grid gap-1" aria-label="Changes waiting to push">
          {all.map((c) => {
            const on = picked.has(c.key);
            const name = c.label;
            return (
              <li key={c.key} className={cn(rowClass(on), "h-auto items-start py-2 pr-1", on && "bg-[var(--typren-fill-subtle-selected)]")}>
                <div className="min-w-0 flex-1">
                  <CheckboxRow
                    label={name}
                    checked={on}
                    disabled={busy}
                    onChange={(v) => toggle(c.key, v)}
                    note={
                      <>
                        <span className="block truncate">{c.detail}</span>
                        {c.note && <span className="block truncate">{c.note}</span>}
                      </>
                    }
                  />
                </div>
                <span className="shrink-0 self-center text-xs font-normal text-[var(--typren-muted-fg)]">{c.kind}</span>
                <span className="flex shrink-0 self-center">
                  <Button variant="ghost" size="icon-sm" aria-label={`Push ${name}`} title="Push" disabled={busy} onClick={() => run("push", [c.key])}>
                    <Upload />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Discard ${name}`} title="Discard" disabled={busy} onClick={() => run("discard", [c.key])}>
                    <Undo2 />
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Loading>
  );

  const extras = (
    <>
      {rows && note && <p className="text-[var(--typren-muted-fg)]">{note}</p>}
      {error && (
        <div role="alert" className="flex items-start gap-3 text-sm">
          <span className="grid min-w-0 flex-1">
            <span className="font-medium text-[var(--typren-destructive)]">{error.title}</span>
            <span>{error.text}</span>
          </span>
          {/* After a failed first load there is no selection to keep yet. */}
          <Button variant="outline" size="sm" className="pr-3.5 pl-2.5" disabled={busy} onClick={() => void load(all.length ? picked : undefined)}>
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        </div>
      )}
    </>
  );

  const footer = (
    <DialogFooter className="flex-wrap">
      <Button variant="outline" disabled={busy} onClick={onClose}>
        Close
      </Button>
      {rows && (
        <>
          <Button variant="destructive" disabled={busy || !chosen.length} onClick={() => run("discard", chosen)}>
            Discard selected
          </Button>
          <Button disabled={busy || !chosen.length} onClick={() => run("push", chosen)}>
            Push selected
          </Button>
        </>
      )}
    </DialogFooter>
  );

  const onOpenChange = (o: boolean) => !o && !busy && onClose();
  const title = "Review changes";
  return (
    <>
      {phone ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            title={title}
            header={
              <>
                <span className="text-base font-medium">{title}</span>
                {selectAll}
              </>
            }
          >
            <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3">
              {/* The scroller sizes its content to fit-content; pin the sheet's own width (less px-3) so rows truncate. */}
              <div className="flex w-[calc(100vw-1.5rem)] flex-col">{body}</div>
            </ScrollArea>
            <div className="grid shrink-0 gap-3 p-3">
              {extras}
              {footer}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>{title}</DialogTitle>
            {selectAll && <div className="px-3">{selectAll}</div>}
            <ScrollArea className="max-h-[min(60vh,28rem)]" viewportClassName="h-auto max-h-[inherit]">
              <div className="flex flex-col">{body}</div>
            </ScrollArea>
            {extras}
            {footer}
          </DialogContent>
        </Dialog>
      )}
      {confirmDialog}
    </>
  );
}

/** A shell command to run once, with a button that copies it. */
function CopyCommand({ command }: Readonly<{ command: string }>) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex w-full min-w-0 items-center gap-1 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-subtle-hover)] py-1 pr-1 pl-3 text-left">
      {/* Breaks only at spaces and after slashes, so a branch name never splits mid-word. */}
      <code className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere] text-[var(--typren-text-primary)]">
        {command.split("/").map((part, i) => (
          <Fragment key={i}>
            {i > 0 && <>/<wbr /></>}
            {part}
          </Fragment>
        ))}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 pr-3 pl-2"
        onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true), () => setCopied(false))}
      >
        <Copy aria-hidden />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
