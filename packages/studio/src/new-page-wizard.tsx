"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, Folder, LayoutTemplate, Rows3, Square } from "lucide-react";
import {
  slugError,
  slugify,
  type PageInfo,
  type PageTemplate,
  type Slice,
} from "@typren/core";
import { useT } from "./intl";
import {
  SliceListEditor,
  TemplateStack,
  useLibraryEntries,
} from "./page-templates";
import { Button } from "./primitives/button";
import { ChoiceCard } from "./primitives/choice-card";
import { cn } from "./primitives/cn";
import { Dialog, DialogContent, DialogTitle } from "./primitives/dialog";
import { EmptyState } from "./primitives/empty";
import { Input } from "./primitives/input";
import { ScrollArea } from "./primitives/scroll-area";
import { pageTree, type PageNode } from "./site-rail";
import type { TyprenStudioHost } from "./types";

type Start = "blank" | "template" | "assemble";
type Step = "title" | "location" | "slug" | "start" | "review";
const PAGE_STEPS: Step[] = ["title", "location", "slug", "start", "review"];
const FOLDER_STEPS: Step[] = ["location", "slug", "review"];
const flat = (nodes: PageNode[]): PageNode[] =>
  nodes.flatMap((n) => [n, ...flat(n.children)]);

/** Slides a step in from below going forward, from above going back; instant
 *  under reduced motion. Same Web Animations approach as `useViewSlide`. */
function useStepSlide(index: number) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(index);
  useLayoutEffect(() => {
    const dir = Math.sign(index - last.current);
    last.current = index;
    if (!dir || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      return;
    ref.current?.animate?.(
      [
        { transform: `translateY(${dir * 32}px)`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 300, easing: "cubic-bezier(0, 0, 0.2, 1)" },
    );
  }, [index]);
  return ref;
}

/**
 * The new-page wizard: a centred dialog asking one question per step, in the
 * manner of a survey. Title, location, URL, how to start (blank, a page
 * template, or sections assembled here), then a review. "Only a folder" asks
 * just where and what to call it. Enter moves on, Back goes back.
 */
export function NewPageWizard({
  host,
  pages,
  folders = [],
  template,
  onClose,
  onPage,
  onFolder,
}: Readonly<{
  host: TyprenStudioHost;
  pages: PageInfo[];
  folders?: string[];
  /** Opened from a page template: start from it. */
  template?: PageTemplate;
  onClose: () => void;
  /** Creates the page; the wizard stays open showing the error if it throws. */
  onPage: (title: string, slug: string, slices: Slice[]) => Promise<void>;
  /** Omitted when the host can't keep folders: no "Only a folder" then. */
  onFolder?: (path: string) => Promise<void>;
}>) {
  const t = useT();
  const [folderOnly, setFolderOnly] = useState(false);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [parent, setParent] = useState("");
  const [segment, setSegment] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [start, setStart] = useState<Start>(template ? "template" : "blank");
  const [templates, setTemplates] = useState<PageTemplate[]>(
    template ? [template] : [],
  );
  const [templateId, setTemplateId] = useState(template?.id ?? "");
  const [assembled, setAssembled] = useState<Slice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices = useLibraryEntries(host);
  useEffect(() => {
    let live = true;
    host.library?.templates?.list().then(
      (list) =>
        live &&
        setTemplates(
          template && !list.some((x) => x.id === template.id)
            ? [template, ...list]
            : list,
        ),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [host.library, template]);

  const steps = folderOnly ? FOLDER_STEPS : PAGE_STEPS;
  const at = steps[Math.min(step, steps.length - 1)]!;
  const slide = useStepSlide(step);
  const submit = useRef<HTMLButtonElement>(null);
  // Each step takes focus, so Enter and the arrows work straight away: its
  // field, its chosen option, or (the review) the Create button.
  useEffect(() => {
    (
      slide.current?.querySelector<HTMLElement>("input:checked, input") ??
      submit.current
    )?.focus();
  }, [at, folderOnly, slide]);
  const tree = pageTree(pages, folders);
  const nodes = flat(tree);
  const siblings = parent
    ? (nodes.find((n) => n.path === parent)?.children ?? [])
    : tree;
  const slug =
    slugTouched || folderOnly ? segment : slugify(title).slice(0, 64);
  const slugErr = slug
    ? slugError(
        slug,
        siblings.map((n) => n.segment),
      )
    : null;
  const path = parent ? `${parent}/${slug}` : slug;
  const picked = templates.find((x) => x.id === templateId);
  const slices =
    start === "template"
      ? (picked?.slices ?? [])
      : start === "assemble"
        ? assembled
        : [];

  const ready: Record<Step, boolean> = {
    title: !!title.trim(),
    location: true,
    slug: !!slug && !slugErr,
    start: start !== "template" || !!picked,
    review: !busy,
  };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      if (folderOnly) await onFolder?.(path);
      else await onPage(title.trim(), path, slices);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const next = () => {
    if (!ready[at]) return;
    if (at === "review") void create();
    else setStep((s) => s + 1);
  };
  const back = () => {
    if (step > 0) setStep((s) => s - 1);
    else if (folderOnly) setFolderOnly(false);
  };
  const toFolder = () => {
    setFolderOnly(true);
    setStep(0);
    setSegment(slug);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    // Enter moves on from any field or choice, as in a survey; a button or an
    // open list keeps its own Enter.
    const el = e.target as HTMLElement;
    if (
      e.key !== "Enter" ||
      el.tagName === "BUTTON" ||
      el.tagName === "TEXTAREA" ||
      el.getAttribute("role") === "combobox"
    )
      return;
    e.preventDefault();
    next();
  };
  const question = (text: string, hint?: ReactNode) => (
    <div className="flex flex-col gap-2">
      <DialogTitle className="text-3xl font-semibold leading-tight tracking-tight">
        {text}
      </DialogTitle>
      {hint && (
        <p className="text-base text-[var(--typren-muted-fg)]">{hint}</p>
      )}
    </div>
  );
  const big = "h-14 text-xl md:text-xl";

  let body: ReactNode;
  switch (at) {
    case "title":
      body = (
        <>
          {question(
            "What’s this page called?",
            "Visitors see it in the browser tab and in search results.",
          )}
          <Input
            aria-label="Title"
            className={big}
            placeholder={t("nav.pageName")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {onFolder && (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={toFolder}
            >
              <Folder /> Only a folder, no page
            </Button>
          )}
        </>
      );
      break;
    case "location":
      body = (
        <>
          {question(
            folderOnly
              ? "Where should the folder live?"
              : "Where should it live?",
            "Its URL starts with this.",
          )}
          <ScrollArea
            className="max-h-72"
            viewportClassName="h-auto max-h-[inherit] p-0.5"
          >
            <div
              role="radiogroup"
              aria-label="Location"
              className="flex flex-col gap-1.5"
            >
              {["", ...nodes.map((n) => n.path)].map((p, i) => (
                <ChoiceCard
                  key={p || "/"}
                  name="typren-location"
                  checked={parent === p}
                  onSelect={() => setParent(p)}
                >
                  <span className="font-mono text-base">/{p}</span>
                  {i === 0 && (
                    <span className="text-sm text-[var(--typren-muted-fg)]">
                      The site root
                    </span>
                  )}
                </ChoiceCard>
              ))}
            </div>
          </ScrollArea>
        </>
      );
      break;
    case "slug":
      body = (
        <>
          {question(
            folderOnly ? "What’s the folder called?" : "What’s its URL?",
            <span className="font-mono">/{path}</span>,
          )}
          <Input
            aria-label="Slug"
            className={cn(big, "font-mono")}
            placeholder="pricing"
            value={slug}
            aria-invalid={slugErr ? true : undefined}
            aria-describedby={slugErr ? "typren-wizard-slug-error" : undefined}
            onChange={(e) => {
              setSlugTouched(true);
              setSegment(e.target.value);
            }}
          />
          {slugErr && (
            <p
              id="typren-wizard-slug-error"
              role="alert"
              className="text-sm text-[var(--typren-destructive)]"
            >
              {slugErr}
            </p>
          )}
        </>
      );
      break;
    case "start":
      body = (
        <>
          {question("How do you want to start?")}
          <div
            role="radiogroup"
            aria-label="Start"
            className="grid grid-cols-3 gap-2 p-0.5"
          >
            {(
              [
                ["blank", "Blank", Square],
                ["template", "From a page template", LayoutTemplate],
                ["assemble", "Assemble sections", Rows3],
              ] as const
            ).map(([value, label, Icon]) => (
              <ChoiceCard
                key={value}
                name="typren-start"
                checked={start === value}
                onSelect={() => setStart(value)}
                className="flex-col py-4 text-center"
              >
                <Icon className="size-5" aria-hidden />
                <span className="text-sm font-medium">{label}</span>
              </ChoiceCard>
            ))}
          </div>
          {start === "template" &&
            (templates.length === 0 ? (
              <EmptyState icon={<LayoutTemplate />} title="No page templates yet." description="Make one under Website, Templates, Pages." />
            ) : (
              <ScrollArea
                className="max-h-80"
                viewportClassName="h-auto max-h-[inherit] p-0.5"
              >
                <div
                  role="radiogroup"
                  aria-label="Page template"
                  className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3"
                >
                  {templates.map((x) => (
                    <ChoiceCard
                      key={x.id}
                      name="typren-template"
                      checked={templateId === x.id}
                      onSelect={() => setTemplateId(x.id)}
                      className="flex-col items-stretch p-2"
                    >
                      <TemplateStack host={host} slices={x.slices} />
                      <span className="truncate text-center text-sm">
                        {x.name}
                      </span>
                    </ChoiceCard>
                  ))}
                </div>
              </ScrollArea>
            ))}
          {start === "assemble" && (
            <div className="grid min-h-0 grid-cols-[16rem_1fr] gap-4">
              <ScrollArea
                className="max-h-80"
                viewportClassName="h-auto max-h-[inherit] p-0.5"
              >
                <SliceListEditor
                  slices={assembled}
                  choices={choices}
                  onChange={setAssembled}
                />
              </ScrollArea>
              <div
                aria-label="Preview"
                className="flex max-h-80 min-h-40 justify-center overflow-hidden rounded-[var(--typren-radius-card)] bg-[var(--typren-fill-subtle-hover)] p-(--typren-inset-card)"
              >
                <TemplateStack host={host} slices={assembled} column />
              </div>
            </div>
          )}
        </>
      );
      break;
    case "review":
      body = (
        <>
          {question(
            folderOnly ? "Add this folder?" : "Ready to create it?",
            folderOnly
              ? undefined
              : "It starts as a draft; nothing goes live until you publish.",
          )}
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-base">
            {!folderOnly && (
              <>
                <dt className="text-[var(--typren-muted-fg)]">Title</dt>
                <dd>{title.trim()}</dd>
              </>
            )}
            <dt className="text-[var(--typren-muted-fg)]">URL</dt>
            <dd className="font-mono">/{path}</dd>
            {!folderOnly && (
              <>
                <dt className="text-[var(--typren-muted-fg)]">Starts with</dt>
                <dd>
                  {start === "blank"
                    ? "A blank page"
                    : start === "template"
                      ? `The ${picked?.name} template, ${slices.length} section${slices.length === 1 ? "" : "s"}`
                      : `${slices.length} section${slices.length === 1 ? "" : "s"}`}
                </dd>
              </>
            )}
          </dl>
          {error && (
            <p
              role="alert"
              className="text-sm text-[var(--typren-destructive)]"
            >
              {error}
            </p>
          )}
        </>
      );
      break;
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className={cn(
          "gap-6 p-8",
          at === "start" && start === "assemble"
            ? "w-[min(92vw,960px)]"
            : "w-[min(92vw,720px)]",
        )}
      >
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of ${steps.length}`}
          className="h-1 overflow-hidden rounded-full bg-[var(--typren-fill-subtle-hover)]"
        >
          <div
            className="h-full origin-left rounded-full bg-[var(--typren-fg)] transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${(step + 1) / steps.length})` }}
          />
        </div>
        <form
          aria-label={t("nav.newPage")}
          className="flex flex-col gap-6"
          onKeyDown={onKeyDown}
          onSubmit={(e: FormEvent) => (e.preventDefault(), next())}
        >
          <div
            ref={slide}
            key={`${folderOnly}:${at}`}
            className="flex min-h-56 flex-col gap-5"
          >
            {body}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy || (step === 0 && !folderOnly)}
              onClick={back}
            >
              <ArrowLeft /> Back
            </Button>
            <span className="flex-1 text-sm tabular-nums text-[var(--typren-muted-fg)]">
              {step + 1} of {steps.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button ref={submit} type="submit" disabled={!ready[at]}>
              {at === "review"
                ? folderOnly
                  ? "Add folder"
                  : "Create page"
                : "OK"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
