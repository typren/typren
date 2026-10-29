"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Check, History, LoaderCircle, RefreshCw } from "lucide-react";
import type { GitLogEntry, SaveResult } from "@typren/core";
import { useT } from "./intl";
import { Button } from "./primitives/button";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives/popover";
import { cn } from "./primitives/cn";
import { EmptyState } from "./primitives/empty";
import { ScrollArea } from "./primitives/scroll-area";
import { Skeleton } from "./primitives/skeleton";

/** What the page's autosave is doing now. */
export type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** `then` relative to `now` in short words ("2 min. ago"), or null under a
 *  minute, which reads as "just now". */
export function ago(then: number, now: number, locale?: string): string | null {
  const seconds = Math.max(0, (now - then) / 1000);
  for (const [unit, size] of UNITS)
    if (seconds >= size) return new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" }).format(-Math.floor(seconds / size), unit);
  return null;
}

/**
 * Autosave for one draft: `write` runs about 0.8s after the last `edit()`,
 * one write at a time, against the version the last write returned. A write
 * that lands after newer edits leaves them dirty for the next one. A lost
 * race (`ok: false`) or a thrown error stops autosave until `reset`, a later
 * `flush` or a successful write clears it. `write` is read at call time, so
 * it may close over the latest value.
 */
export function useAutosave({
  enabled,
  version,
  drafted,
  write,
  onSaved,
}: Readonly<{
  /** Off while the value is invalid, or before it loaded. */
  enabled: boolean;
  /** The loaded version and draft mark; `reset` takes new ones. */
  version: string | null;
  drafted: boolean;
  write: (baseVersion: string | undefined) => Promise<SaveResult>;
  onSaved?: () => void;
}>) {
  const [dirty, setDirty] = useState(false);
  const [rev, setRev] = useState(0);
  const [hasDraft, setDrafted] = useState(drafted);
  const [base, setBase] = useState(version);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const live = useRef({ write, onSaved, base: version, dirty: false, edits: 0 });
  const inflight = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    live.current.write = write;
    live.current.onSaved = onSaved;
  });

  /** Marks an edit: the debounce starts over. Stable, for effects. */
  const edit = useCallback(() => {
    live.current.edits++;
    live.current.dirty = true;
    setDirty(true);
    setRev((n) => n + 1);
  }, []);

  const save = async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const seq = live.current.edits;
    setSaving(true);
    const run = (async () => {
      try {
        const res = await live.current.write(live.current.base ?? undefined);
        if (!res.ok) {
          setConflict(true);
          return false;
        }
        const clean = seq === live.current.edits;
        Object.assign(live.current, { base: res.version, dirty: !clean });
        setBase(res.version);
        if (clean) setDirty(false);
        setDrafted(true);
        setSavedAt(Date.now());
        setError("");
        live.current.onSaved?.();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSaving(false);
      }
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      if (inflight.current === run) inflight.current = null;
    }
  };

  useEffect(() => {
    if (!enabled || !dirty || conflict || error) return;
    const tmr = setTimeout(() => void save(), 800);
    return () => clearTimeout(tmr);
    // `save` reads the latest write itself; these are the triggers.
  }, [enabled, rev, dirty, conflict, error]);

  const state: SaveState = conflict ? "conflict" : error ? "error" : saving || dirty ? "saving" : savedAt !== null ? "saved" : "idle";
  return {
    dirty,
    drafted: hasDraft,
    version: base,
    conflict,
    error,
    /** True while a write runs. */
    busy: saving,
    /** `SaveStatus`'s props, less `history`. */
    status: { state, savedAt, drafted: hasDraft || dirty },
    edit,
    save,
    /** The version the last write returned, read now (not at render). */
    base: () => live.current.base ?? undefined,
    /** Saves what is not saved yet, waiting out a write in flight; true once
     *  nothing is left unsaved. */
    async flush() {
      if (inflight.current && !(await inflight.current)) return false;
      return live.current.dirty ? save() : true;
    },
    /** Starts over from a freshly loaded copy. */
    reset(nextVersion: string | null, nextDrafted: boolean) {
      Object.assign(live.current, { base: nextVersion, dirty: false });
      setBase(nextVersion);
      setDrafted(nextDrafted);
      setDirty(false);
      setConflict(false);
      setError("");
      setSavedAt(null);
    },
    /** Takes a write made outside autosave (an overwrite, a publish). */
    saved(nextVersion: string, nextDrafted = true) {
      Object.assign(live.current, { base: nextVersion, dirty: false });
      setBase(nextVersion);
      setDrafted(nextDrafted);
      setDirty(false);
      setConflict(false);
      setError("");
      if (nextDrafted) setSavedAt(Date.now());
    },
    setConflict,
  };
}

export type Autosave = ReturnType<typeof useAutosave>;

/** `Date.now()`, again every `ms`, so relative times stay true while shown. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * The edit bar's save status: "Saving…", "Saved just now", "Saved 5 min.
 * ago", or why the last save failed, never "Saved" then. With `history` it
 * opens the page's version history on hover or focus: its commits newest
 * first (subject, author, time, short hash) under an "Unpushed draft" row
 * while the page has a draft. Read-only.
 */
export function SaveStatus({
  state,
  savedAt,
  drafted,
  history,
  portal,
}: Readonly<{
  state: SaveState;
  savedAt: number | null;
  /** The page has a saved draft not pushed yet. */
  drafted: boolean;
  history?: () => Promise<GitLogEntry[]>;
  portal?: HTMLElement | null;
}>) {
  const t = useT();
  const now = useNow(15_000);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<GitLogEntry[] | null | "failed">(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!open || !history) return;
    let live = true;
    setLog(null);
    history().then(
      (l) => live && setLog(l),
      () => live && setLog("failed")
    );
    return () => {
      live = false;
    };
    // `history` is rebuilt each render; opening or retrying is the load signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tries]);

  const when = savedAt === null ? null : ago(savedAt, now);
  const label =
    state === "conflict"
      ? t("shell.notSavedConflict")
      : state === "error"
        ? t("shell.notSaved")
        : state === "saving"
          ? t("shell.saving")
          : savedAt !== null
            ? when
              ? t("shell.savedAgo", { ago: when })
              : t("shell.savedJustNow")
            : drafted
              ? t("shell.draftSaved")
              : t("shell.upToDate");
  const failed = state === "conflict" || state === "error";
  const Icon = failed ? CircleAlert : state === "saving" ? LoaderCircle : Check;
  const content = (
    <>
      <Icon aria-hidden className={failed ? "text-[var(--typren-destructive)]" : state === "saving" ? "motion-safe:animate-spin" : undefined} />
      <span aria-live="polite">{label}</span>
    </>
  );
  const className = "pr-3 pl-2 font-normal text-[var(--typren-muted-fg)] tabular-nums";
  if (!history)
    return (
      <span className={`inline-flex h-8 items-center gap-1.5 text-sm [&_svg]:size-4 ${className}`} role="status">
        {content}
      </span>
    );
  return (
    <Popover open={open} onOpenChange={(next, details) => (next || details.reason !== "trigger-press") && setOpen(next)}>
      <PopoverTrigger
        openOnHover
        delay={200}
        onFocus={() => setOpen(true)}
        render={<Button variant="ghost" size="sm" aria-label={`${label}. ${t("shell.history")}`} className={className} />}
      >
        {content}
      </PopoverTrigger>
      {/* Card padding stays off the popup: the header and list pad themselves,
          so the card radius always meets a body at least that tall. */}
      <PopoverContent container={portal} align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <h2 className="px-4 pt-3.5 pb-2 text-sm font-semibold text-[var(--typren-text-primary)]">{t("shell.history")}</h2>
        {log === null ? (
          <ol aria-hidden className="px-4 pb-4">
            {[0, 1, 2].map((i) => (
              <Entry key={i} node="commit" last={i === 2}>
                <Skeleton className="mt-0.5 h-4 w-4/5" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
              </Entry>
            ))}
          </ol>
        ) : log === "failed" ? (
          <EmptyState icon={<CircleAlert />} title={t("shell.historyFailed")} className="py-6">
            <Button variant="outline" size="sm" className="pr-3.5 pl-2.5" onClick={() => setTries((n) => n + 1)}>
              <RefreshCw aria-hidden />
              {t("shell.reload")}
            </Button>
          </EmptyState>
        ) : !drafted && !log.length ? (
          <EmptyState icon={<History />} title={t("shell.noHistory")} className="py-6" />
        ) : (
          <ScrollArea viewportClassName="max-h-[21rem]">
            <ol className="px-4 pb-4" aria-label={t("shell.history")}>
              {drafted && (
                <Entry node="draft" last={!log.length}>
                  <p className="text-sm/5">
                    <span className="font-medium text-[var(--typren-text-primary)]">{t("shell.historyDraft")}</span>
                    {savedAt !== null && (
                      <span className="text-[var(--typren-text-secondary)]">
                        {" · "}
                        {t("shell.historyDraftSaved", { ago: when ?? t("shell.justNow") })}
                      </span>
                    )}
                  </p>
                  <p className="text-xs/5 text-[var(--typren-text-secondary)]">{t("shell.historyNotPushed")}</p>
                </Entry>
              )}
              {log.map((e, i) => (
                <Entry key={e.hash} node="commit" last={i === log.length - 1}>
                  <p className="line-clamp-2 text-sm/5 text-[var(--typren-text-primary)]" title={e.subject}>
                    {e.subject}
                  </p>
                  <p className="flex items-center gap-2 text-xs/5 text-[var(--typren-text-secondary)]">
                    <span className="min-w-0 truncate">
                      {e.author} ·{" "}
                      <time dateTime={e.date} title={new Date(e.date).toLocaleString()}>
                        {ago(Date.parse(e.date), now) ?? t("shell.justNow")}
                      </time>
                    </span>
                    <code className="ml-auto shrink-0 rounded-[var(--typren-radius-sm)] bg-[var(--typren-fill-subtle-hover)] px-1.5 font-mono text-[11px]/4">
                      {e.hash}
                    </code>
                  </p>
                </Entry>
              ))}
            </ol>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One row of the history's commit graph: a node on the rail beside its
 * content, the node centred on the first line (`text-sm/5`, so 10px down).
 * The rail is this row's `::before`, from its node to the next row's, so it
 * never runs past the first or last node. A draft's node is hollow and its
 * segment dashed, in the accent: it isn't committed yet.
 */
function Entry({ node, last, children }: Readonly<{ node: "draft" | "commit"; last: boolean; children: ReactNode }>) {
  return (
    <li
      className={cn(
        "relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-3 last:pb-0",
        !last &&
          "before:absolute before:top-2.5 before:-bottom-2.5 before:left-[calc(0.5rem-0.5px)] before:border-l before:border-[color-mix(in_srgb,var(--typren-text-secondary)_35%,transparent)]",
        !last && node === "draft" && "before:border-dashed before:border-[var(--typren-fill-accent)]"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative z-10 mt-[5px] ml-[3px] size-2.5 rounded-full",
          node === "draft"
            ? "border-2 border-[var(--typren-fill-accent)] bg-[var(--typren-popover)]"
            : "bg-[var(--typren-text-secondary)] ring-2 ring-[var(--typren-popover)]"
        )}
      />
      <div className="min-w-0">{children}</div>
    </li>
  );
}
