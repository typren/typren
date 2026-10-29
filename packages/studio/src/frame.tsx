"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ChevronLeft,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
} from "lucide-react";
import { AnnounceContext, useAnnounce } from "./announce";
import { DeviceToggle, type Device } from "./device-preview";
import { LocaleSelect, type LocaleSwitch } from "./locale-select";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { useMediaQuery } from "./primitives/media-query";
import { Sheet, SheetContent, SheetTrigger } from "./primitives/sheet";
import { ClearSearch, SearchInput, clearOnEscape } from "./primitives/search-input";
import { PortalContext } from "./primitives/portal";
import { ScrollArea } from "./primitives/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "./primitives/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./primitives/tooltip";
import { TopBarButton } from "./primitives/top-bar-button";
import { useReveal } from "./reveal";
import { useStoredChoice } from "./use-stored-choice";

/** What the rail header shows: the product name at the root, a back chevron
 *  plus the parent's label once drilled in. */
export type RailBack = { label: string; onBack: () => void } | null;

/** The Typren mark, inline so it takes `currentColor`. The source is 275x270;
 *  height is what's set, because the mark pairs with type. */
function TyprenMark() {
  return (
    <svg
      viewBox="0 0 275 270"
      aria-hidden
      focusable="false"
      className="h-[22px] w-auto text-[var(--typren-brand)]"
    >
      <path
        fill="currentColor"
        d="M147.865 145.818L126.737 224.667L126.727 224.651C124.558 232.749 119.538 239.749 112.652 244.427L109.427 246.442L74.8141 266.404C65.073 272.028 52.6149 268.69 46.9909 258.949L29.3684 228.426C23.7444 218.685 27.0825 206.227 36.8236 200.603L141.194 140.344C147.365 136.782 151.856 130.92 153.699 124.042L174.904 44.9066C177.073 36.8088 182.093 29.8083 188.979 25.1303L192.204 23.1151L48.1775 106.269C38.4365 111.893 25.9783 108.554 20.3543 98.8134L2.73181 68.2903C-2.89219 58.5493 0.445961 46.0911 10.187 40.4671L72.1875 4.6711C80.1844 0.0540996 89.7021 -1.20669 98.6305 1.18565L180.39 21.1598C187.284 22.84 194.576 21.7895 200.713 18.246L226.81 3.17896C236.551 -2.44503 249.009 0.893126 254.633 10.6342L272.256 41.1572C277.88 50.8983 274.541 63.3564 264.8 68.9804L160.709 129.077C154.374 132.735 149.756 138.758 147.865 145.818Z"
      />
    </svg>
  );
}

const TABLET = "(min-width: 48rem) and (max-width: 63.99rem)";

/** Slides the rail and its header in from the side the user is heading:
 *  deeper comes in from the right, Back from the left, and a sideways move
 *  between views at the same depth (Pages to Assets) from the right too. Web
 *  Animations, so no keyframes need shipping. */
function useRailSlide(level: number, view = "") {
  const head = useRef<HTMLSpanElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const last = useRef({ level, view });
  useLayoutEffect(() => {
    const dir = Math.sign(level - last.current.level) || (view !== last.current.view ? 1 : 0);
    last.current = { level, view };
    if (!dir || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      return;
    for (const el of [head.current, rail.current])
      el?.animate?.(
        [
          { transform: `translateX(${dir * 48}px)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 560, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
  }, [level, view]);
  return { head, rail };
}

/** Fades the main area up into place when it switches to a different screen:
 *  the site preview to a Typren screen such as Assets or Settings, or one
 *  Typren screen to another. Moving between pages inside the preview keeps
 *  the same `screen`, so the preview never flickers. */
function useScreenFade(screen: string) {
  const main = useRef<HTMLElement>(null);
  const lastScreen = useRef(screen);
  useLayoutEffect(() => {
    const changed = lastScreen.current !== screen;
    lastScreen.current = screen;
    if (
      !changed ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    main.current?.animate?.(
      [
        { transform: "translateY(12px)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 420, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [screen]);
  return main;
}

const calm = "cubic-bezier(0.2, 0, 0, 1)";
const still = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The search cell's narrowest width before the pill gives way to the search
 *  button (its `@[16rem]` container query), and the top bar's gap. */
const SEARCH_MIN = 256;
const BAR_GAP = 12;
/** The gap between Edit and the toolbar grown out of it (gap-2). */
const MORPH_GAP = 8;

/** The top bar's layout from md up. `side`: the width both cells beside the
 *  search reserve, the wider one's controls, so the pill stays centred over
 *  the card whichever side holds more. `inline`: whether the edit toolbar
 *  sits in the bar beside Edit, which it does only while the pill keeps its
 *  minimum width centred with it there; otherwise it opens in the row under
 *  the bar. Decided in render from widths measured while browsing (the
 *  toolbar's from its last showing), so opening places it right the first
 *  time instead of opening the row and jumping into the bar. */
function useBarLayout(open: boolean, searchCell: RefObject<HTMLDivElement | null>, tools: RefObject<HTMLDivElement | null>) {
  // `area`: from the first cell's start to the last one's end; `left`: the
  // first cell's controls without the toolbar.
  const [m, setM] = useState({ area: 0, left: 0, right: 0, tools: 0, md: true });
  const room = (left: number) => m.area - 2 * Math.max(left, m.right) - 2 * BAR_GAP;
  const inline = open && m.md && room(m.left + m.tools + MORPH_GAP) >= SEARCH_MIN;
  useLayoutEffect(() => {
    const cell = searchCell.current;
    const first = cell?.previousElementSibling;
    const last = cell?.nextElementSibling;
    if (!cell || !first || !last) return;
    const fit = () =>
      setM((was) => {
        const el = tools.current;
        const inBar = Boolean(open && el && first.contains(el));
        // The row may wrap the toolbar narrower than it sits in the bar; never
        // taking that as its width keeps it from flipping back and forth.
        const w = open && el ? (inBar ? el.offsetWidth : Math.max(el.offsetWidth, was.tools)) : was.tools;
        const a = first.getBoundingClientRect();
        const b = last.getBoundingClientRect();
        const shown = (box: Element) => [...box.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
        const next = {
          area: b.right - a.left,
          left: Math.max(0, ...shown(first).map((r) => r.right - a.left)) - (inBar ? w + MORPH_GAP : 0),
          right: Math.max(0, ...shown(last).map((r) => b.right - r.left)),
          tools: w,
          md: window.matchMedia?.("(min-width: 48rem)").matches ?? true,
        };
        return (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === was[k]) ? was : next;
      });
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    for (const el of [first, cell, last, ...first.children, ...last.children]) ro.observe(el);
    if (tools.current) ro.observe(tools.current);
    return () => ro.disconnect();
  }, [open, inline, searchCell, tools]);
  return { inline, side: Math.max(inline ? m.left + m.tools + MORPH_GAP : m.left, m.right) };
}

/** The edit toolbar row above the main area. It opens and folds away over
 *  200ms (height and opacity), carrying the content below it smoothly, and
 *  instantly under reduced motion; its controls wrap on a narrow screen.
 *  Rendered empty and 0 high while closed. */
function ToolbarRow({ children, tools }: Readonly<{ children?: ReactNode; tools: RefObject<HTMLDivElement | null> }>) {
  const row = useRef<HTMLDivElement>(null);
  const open = Boolean(children);
  // The open row's height, to fold it away from.
  const shown = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (!still()) {
      if (open && shown.current === null)
        el.animate?.([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 200, easing: calm });
      if (!open && shown.current !== null)
        el.animate?.([{ height: `${shown.current}px` }, { height: "0px" }], { duration: 200, easing: calm });
    }
    shown.current = open ? h : null;
  }, [open]);
  return (
    <div
      ref={row}
      id={open ? "typren-edit-row" : undefined}
      role={open ? "group" : undefined}
      aria-label={open ? "Edit" : undefined}
      className="shrink-0 overflow-hidden"
    >
      {open && (
        // Padded for focus rings the row would clip, and pulled back by as
        // much, so its first control sits on the card's left edge.
        <div ref={tools} className="-mx-0.5 flex w-fit max-w-full flex-wrap items-center gap-2 p-0.5 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}

/** One persistent slot for a set of top-bar controls. When the set changes
 *  (device toggle to the Assets view toggle) the old set fades out, the
 *  slot's width eases from the old set's width to the new one's (the only
 *  layout property animated, once, on one element), and the new set fades
 *  in, so it reads as one control reshaping. */
function ControlSwap({
  id,
  className,
  children,
}: Readonly<{
  id: string;
  className?: string;
  children: ReactNode;
}>) {
  const [shown, setShown] = useState<{ id: string; children: ReactNode }>({ id, children });
  const box = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);
  useEffect(() => {
    if (shown.id === id) return;
    if (still()) return setShown({ id, children });
    const out = box.current?.firstElementChild?.animate?.(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 120, easing: "ease-in", fill: "forwards" },
    );
    // Measured at the swap, so an effect re-run (StrictMode) cannot leave a
    // stale width for the layout effect below to animate from.
    const t = setTimeout(() => {
      from.current = box.current?.offsetWidth ?? null;
      setShown({ id, children });
    }, 120);
    // A swap abandoned mid-fade (switching straight back) must not leave the
    // still-shown control held at opacity 0 by the forwards fill.
    return () => {
      clearTimeout(t);
      out?.cancel();
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps -- children are read once, at the swap
  useLayoutEffect(() => {
    const el = box.current;
    if (from.current === null || !el) return;
    const start = from.current;
    from.current = null;
    el.animate?.([{ width: `${start}px` }, { width: `${el.offsetWidth}px` }], {
      duration: 240,
      easing: calm,
    });
    el.firstElementChild?.animate?.(
      [
        { opacity: 0, transform: "translateX(8px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 180, easing: "cubic-bezier(0, 0, 0.2, 1)" },
    );
  }, [shown.id]);
  return (
    <div ref={box} className={cn("flex items-center justify-end", className)}>
      <div key={shown.id} className="flex items-center gap-2">
        {shown.id === id ? children : shown.children}
      </div>
    </div>
  );
}

/** iOS's own curve: a quick start that settles softly. */
const settle = "cubic-bezier(0.32, 0.72, 0, 1)";

/** Edit morphing into the edit toolbar where the top bar has room: one
 *  container that stays mounted while Edit's label folds to its pressed
 *  pencil (TopBarButton reads `data-morphed` off `group/actions`) and Save
 *  with Discard or Review grow out of it, the width easing and the new
 *  controls fading in over 200ms, and back. Focus follows the morph: to the
 *  first enabled toolbar button on the way in, back to Edit on the way out
 *  when the button that had it is gone. Instant under reduced motion. */
function ActionMorph({
  morphed,
  tools,
  children,
}: Readonly<{ morphed: boolean; tools: RefObject<HTMLDivElement | null>; children: ReactNode }>) {
  const box = useRef<HTMLDivElement>(null);
  const width = useRef(0);
  const was = useRef(morphed);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const from = width.current;
    width.current = el.offsetWidth;
    if (was.current === morphed) return;
    was.current = morphed;
    const focus = document.activeElement;
    if (morphed && el.contains(focus))
      tools.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    if (!morphed && (!focus || focus === document.body)) el.querySelector<HTMLElement>("button")?.focus();
    if (still() || !from || from === width.current) return;
    // Clipped only while it eases, so focus rings show at rest.
    el.style.overflow = "clip";
    const grow = el.animate?.([{ width: `${from}px` }, { width: `${width.current}px` }], {
      duration: 200,
      easing: settle,
    });
    if (grow) grow.onfinish = grow.oncancel = () => void (el.style.overflow = "");
    else el.style.overflow = "";
    (morphed ? tools.current : el.querySelector("button"))?.animate?.(
      [
        { opacity: 0, transform: "scale(0.96)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 200, easing: settle },
    );
  });
  return (
    <div ref={box} data-morphed={morphed || undefined} className="group/actions flex shrink-0 items-center gap-2">
      {children}
    </div>
  );
}

/** The page shown in the top-centre pill. */
export type PillPage = { title: string; url: string; status: string };

/** One search result. `text` is matched but not shown; a match only there
 *  shows a snippet of it instead of `hint`. */
export type SearchHit = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  text?: string;
};

/** Everything the pill can find. `onOpen` lets the host load the costly
 *  parts (page content, assets) only when someone actually searches. */
export type FrameSearch = {
  hits: SearchHit[];
  onOpen?: () => void;
  onPick: (hit: SearchHit) => void;
};

const pillClass =
  "flex h-[var(--typren-control-h)] w-full items-center justify-center gap-2.5 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] px-4 text-sm shadow-(--typren-elevation)";

// ponytail: module-level for the same reason as `calm`: the pill remounts on
// every page switch, so the previous text has to outlive the instance. A
// remounted pill can only fade the new text in, the old copy is already gone.
const lastShown = new Map<string, string>();

/** Text that morphs in place when `value` changes: the old copy (aria-hidden,
 *  so nothing is announced twice) fades out and lifts while the new one fades
 *  in from below. Unchanged text never moves. Transform and opacity only. */
function Morph({
  slot,
  value,
  className,
}: Readonly<{ slot: string; value: string; className?: string }>) {
  const [ghost, setGhost] = useState<string | null>(null);
  const prev = useRef(lastShown.get(slot) ?? value);
  const now = useRef<HTMLSpanElement>(null);
  const old = useRef<HTMLSpanElement>(null);
  const fresh = useRef(true);
  useLayoutEffect(() => {
    lastShown.set(slot, value);
    if (prev.current === value) return void (fresh.current = false);
    const was = prev.current;
    prev.current = value;
    const remounted = fresh.current;
    fresh.current = false;
    if (still()) return;
    if (!remounted) setGhost(was);
    now.current?.animate?.(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 180, easing: "cubic-bezier(0, 0, 0.2, 1)" },
    );
    const t = setTimeout(() => setGhost(null), 120);
    return () => clearTimeout(t);
  }, [value, slot]);
  useLayoutEffect(() => {
    if (ghost === null) return;
    old.current?.animate?.(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(-4px)" },
      ],
      { duration: 120, easing: "ease-in", fill: "forwards" },
    );
  }, [ghost]);
  return (
    <span className={cn("relative", className)}>
      <span ref={now}>{value}</span>
      {ghost !== null && (
        <span
          ref={old}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap"
        >
          {ghost}
        </span>
      )}
    </span>
  );
}

function PillAnnouncer({ status }: Readonly<{ status: string }>) {
  useAnnounce(status);
  return null;
}

function PillContent({ pill }: Readonly<{ pill?: PillPage }>) {
  if (!pill)
    return (
      <span className="flex items-center gap-2 text-[var(--typren-muted-fg)]">
        <Search className="size-4" aria-hidden />
        Search
      </span>
    );
  return (
    <>
      <Morph slot="title" value={pill.title} className="truncate font-medium" />
      <Morph
        slot="url"
        value={pill.url}
        className="truncate text-xs text-[var(--typren-muted-fg)]"
      />
      <Morph
        slot="status"
        value={pill.status}
        className="shrink-0 text-xs text-[var(--typren-muted-fg)]"
      />
    </>
  );
}

/** Up to `n` hits matching `q`, with a snippet when only `text` matched. */
export function matchHits(hits: SearchHit[], q: string, n = 50): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return hits.slice(0, n);
  const out: SearchHit[] = [];
  for (const h of hits) {
    if (`${h.label} ${h.hint ?? ""}`.toLowerCase().includes(needle))
      out.push(h);
    else {
      const at = h.text?.toLowerCase().indexOf(needle) ?? -1;
      if (at >= 0)
        out.push({
          ...h,
          hint: `…${h.text!.slice(Math.max(0, at - 24), at + needle.length + 24).trim()}…`,
        });
    }
    if (out.length === n) break;
  }
  return out;
}

/** The search both the pill and the narrow-viewport sheet run: the query,
 *  the highlighted match, the combobox wiring for an input, and the grouped
 *  results list. `prefix` keeps the two surfaces' element ids apart. */
function useSearch(search: FrameSearch, prefix: string, open: boolean, done: () => void) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = matchHits(search.hits, query);
  useAnnounce(
    open && query
      ? `${matches.length} ${matches.length === 1 ? "result" : "results"}`
      : "",
  );
  const reset = () => {
    setQuery("");
    setActive(0);
  };
  const pick = (hit: SearchHit) => {
    reset();
    done();
    search.onPick(hit);
  };
  const input = {
    role: "combobox",
    "aria-expanded": open,
    "aria-controls": `${prefix}-results`,
    "aria-activedescendant":
      open && matches[active] ? `${prefix}-${active}` : undefined,
    autoComplete: "off",
    spellCheck: false,
    placeholder: "Search pages, content, assets, settings",
    value: query,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      setActive(0);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const by = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) =>
          Math.min(Math.max(0, i + by), Math.max(0, matches.length - 1)),
        );
      } else if (e.key === "Enter" && matches[active]) pick(matches[active]);
    },
  } as const;
  const list = (
    <ul id={`${prefix}-results`} role="listbox" aria-label="Search results">
      {matches.map((h, i) => (
        <li key={h.id} role="presentation">
          {h.group !== matches[i - 1]?.group && (
            <div
              role="presentation"
              className="px-3 pb-1 pt-2 text-xs text-[var(--typren-muted-fg)]"
            >
              {h.group}
            </div>
          )}
          <div
            id={`${prefix}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(h)}
            className="flex h-9 w-full cursor-default items-center justify-between gap-3 typren-concentric px-3 aria-selected:bg-[var(--typren-fill-subtle-hover)]"
          >
            <span className="max-w-full shrink-0 truncate">{h.label}</span>
            {h.hint && (
              <span className="min-w-0 truncate text-xs text-[var(--typren-muted-fg)]">
                {h.hint}
              </span>
            )}
          </div>
        </li>
      ))}
      {matches.length === 0 && (
        <li className="px-3 py-2 text-[var(--typren-muted-fg)]">
          Nothing matches.
        </li>
      )}
    </ul>
  );
  return { input, list, reset };
}

/** The pill doubles as the one search: sections, pages and their content,
 *  assets, settings. It is the input itself: at rest it shows the current
 *  page, and typing into it lists matches beneath. Arrow keys move through
 *  them, Enter opens the highlighted one, Escape leaves. */
function SearchBox({
  pill,
  search,
}: Readonly<{ pill?: PillPage; search: FrameSearch }>) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const s = useSearch(search, "typren-search", open, () => {
    setOpen(false);
    input.current?.blur();
  });
  const close = () => {
    setOpen(false);
    s.reset();
  };
  return (
    <div className="relative w-full">
      <div
        onClick={() => input.current?.focus()}
        className={cn(
          pillClass,
          "typren-grain cursor-text transition-colors duration-150 hover:bg-[var(--typren-fill-control-hover)] motion-reduce:transition-none",
          open &&
            "bg-[var(--typren-fill-control-input)] ring-2 ring-[var(--typren-ring)] hover:bg-[var(--typren-fill-control-input)]",
        )}
      >
        <div
          aria-hidden={open || undefined}
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center gap-2.5 px-4 transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
            open && "-translate-y-1 opacity-0",
          )}
        >
          <PillContent pill={pill} />
        </div>
        <Search
          className={cn(
            "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--typren-muted-fg)] transition-opacity duration-[180ms] motion-reduce:transition-none",
            !open && "opacity-0",
          )}
          aria-hidden
        />
        <input
          ref={input}
          {...s.input}
          aria-label={pill ? `Search (current page: ${pill.title})` : "Search"}
          onFocus={() => {
            search.onOpen?.();
            setOpen(true);
          }}
          onBlur={close}
          onKeyDown={(e) => {
            if (clearOnEscape(e, s.input.onChange)) return;
            s.input.onKeyDown(e);
            if (e.key === "Escape") input.current?.blur();
          }}
          className={cn(
            "absolute inset-0 size-full rounded-[inherit] bg-transparent pl-9 pr-9 text-sm outline-none placeholder:text-[var(--typren-muted-fg)] placeholder:transition-opacity placeholder:duration-[180ms] motion-reduce:placeholder:transition-none",
            !open && "cursor-pointer text-transparent placeholder:opacity-0",
          )}
        />
        {open && s.input.value && <ClearSearch input={input} onChange={s.input.onChange} />}
      </div>
      {open && (
        <div
          // Keeps focus in the input, so a click lands before blur closes the list.
          onMouseDown={(e) => e.preventDefault()}
          className="typren-surface-2 absolute inset-x-0 top-full z-50 mt-1.5 origin-top transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)] starting:scale-96 starting:opacity-0 motion-reduce:transition-none overflow-hidden rounded-[var(--typren-radius-control)] bg-[var(--typren-popover)] text-sm text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)]"
        >
          <ScrollArea
            className="max-h-96"
            viewportClassName="h-auto max-h-[inherit] p-1"
          >
            {s.list}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

/** Where the pill does not fit, a search button opens the same search in a
 *  large bottom sheet: the field in its header, the results filling the rest. */
function SearchSheet({ search, locale }: Readonly<{ search: FrameSearch; locale?: LocaleSwitch }>) {
  const [open, setOpen] = useState(false);
  const s = useSearch(search, "typren-search-sheet", open, () => setOpen(false));
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) search.onOpen?.();
        else s.reset();
      }}
    >
      <SheetTrigger render={<TopBarButton aria-label="Search" />}>
        <Search />
      </SheetTrigger>
      <SheetContent
        title="Search"
        header={
          <div className="flex gap-2">
            <SearchInput {...s.input} aria-label="Search" autoFocus className="min-w-0 flex-1" />
            {/* A phone's one home for the switcher while browsing (the device cell is md up). */}
            {locale && (
              <span className="flex md:hidden">
                <LocaleSelect {...locale} />
              </span>
            )}
          </div>
        }
      >
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 pb-3">
          {/* The scroller sizes its content to fit-content; pin the sheet's own width (less px-3) so rows truncate. */}
          <div className="w-[calc(100vw-1.5rem)]">{s.list}</div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The one layout every screen shares: rail header, action bar, page pill and
 * device toggle across the top; the drill-down rail on the left; the main
 * area filling the rest. Browse mode and the page editor fill the same slots,
 * so switching between them never moves the chrome.
 */
export function Frame({
  back,
  title,
  level,
  view,
  screen = "preview",
  rail,
  actions,
  pill,
  search,
  device,
  onDevice,
  localeSwitch,
  controls,
  toolbar,
  topBarSlot,
  banner,
  dark,
  onToggleTheme,
  children,
}: Readonly<{
  back: RailBack;
  /** The screen's name: the page's one (visually hidden) h1 and its document title. */
  title?: string;
  /** Rail depth (0 site, 1 pages, 2 page editor); a change slides the rail. */
  level: number;
  /** Which rail is shown at that depth ("pages", "assets"); switching
   *  between two at the same depth slides too. */
  view?: string;
  /** What the main area shows: "preview" for the site, else the Typren
   *  screen's id. A change fades the new screen in. */
  screen?: string;
  rail: ReactNode;
  actions?: ReactNode;
  pill?: PillPage;
  search?: FrameSearch;
  /** Omitted for non-website entries, which have no preview to resize. */
  device?: Device;
  onDevice: (d: Device) => void;
  /** The locale switcher, left of the device toggle; on a phone it moves to
   *  the search sheet's header and the edit toolbar row. Shown with `device`. */
  localeSwitch?: LocaleSwitch;
  /** Screen-specific controls at the top right, e.g. the Assets view toggle. */
  controls?: ReactNode;
  /** The edit toolbar: beside the actions in the top bar while the search
   *  keeps its width there, else a row opened under the bar. */
  toolbar?: ReactNode;
  topBarSlot?: ReactNode;
  banner?: ReactNode;
  dark: boolean;
  onToggleTheme: () => void;
  children: ReactNode;
}>) {
  // Popups portal here, inside the root, so they keep its `.dark` scope.
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const slide = useRailSlide(level, view);
  const main = useScreenFade(screen);
  const reveal = useReveal<HTMLDivElement>();
  const searchCell = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const { inline, side } = useBarLayout(Boolean(toolbar), searchCell, tools);
  // Locales matter only where a page preview shows, as the presets do.
  const locale = device ? localeSwitch : undefined;
  const [live, setLive] = useState("");
  // Below `md` the rail is a drawer over the content, so the main area keeps
  // its width at 320px (WCAG 1.4.10).
  const [railOpen, setRailOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  // From `md` up the rail can be collapsed away; hovering or focusing the
  // expand button then peeks it as a panel over the content.
  const [railChoice, setRailChoice] = useStoredChoice("typren-rail", "expanded", [
    "expanded",
    "collapsed",
  ]);
  // Between md and lg the rail starts collapsed whatever the stored desktop
  // choice; toggling there lasts the visit and never overwrites that choice.
  const tablet = useMediaQuery(TABLET);
  const [tabletPinned, setTabletPinned] = useState(false);
  const collapsed = tablet ? !tabletPinned : railChoice === "collapsed";
  const [peek, setPeek] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  // The expand button peeks only once armed: after collapsing (it glides in
  // under a resting pointer and takes focus) or Escape (focus returns to it),
  // the pointer or focus must leave it and come back first, so the panel
  // never flickers straight back open.
  const armed = useRef(true);
  const peekFromTrigger = () => armed.current && showPeek();
  const leaveTrigger = () => {
    armed.current = true;
    hidePeek();
  };
  const unpeek = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showPeek = () => {
    clearTimeout(unpeek.current);
    setPeek(true);
  };
  // A short grace period lets the pointer cross from the expand button to the
  // panel; focus inside the panel keeps it open for keyboard users.
  const hidePeek = () => {
    clearTimeout(unpeek.current);
    unpeek.current = setTimeout(() => {
      const el = nav.current;
      if (!el?.matches(":hover") && !el?.contains(document.activeElement))
        setPeek(false);
    }, 150);
  };
  useEffect(() => () => clearTimeout(unpeek.current), []);
  // Collapsing or pinning moves the content sideways; it glides from where it
  // was (FLIP) instead of jumping. Measured at the click, played after layout.
  const flip = useRef<Map<Element, number> | null>(null);
  const toggleRail = () => {
    const root = reveal.current;
    if (root && !still())
      flip.current = new Map(
        [...root.querySelectorAll("[data-rail-flip]")]
          // Collapsing, the panel's own transition slides it out.
          .filter((el) => collapsed || el !== nav.current)
          .map((el) => [el, el.getBoundingClientRect().left]),
      );
    setPeek(false);
    // The collapse button is gone after this; focus moves to its replacement.
    armed.current = collapsed;
    if (tablet) setTabletPinned(collapsed);
    else setRailChoice(collapsed ? "expanded" : "collapsed");
  };
  useLayoutEffect(() => {
    if (collapsed && !armed.current) expand.current?.focus();
    const before = flip.current;
    flip.current = null;
    for (const [el, x] of before ?? []) {
      const dx = x - el.getBoundingClientRect().left;
      if (dx)
        el.animate?.(
          [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
          { duration: 200, easing: calm },
        );
    }
    // The header's lockup returns in place; fading it in keeps the actions
    // gliding out from under it from reading as an overlap.
    if (before && !collapsed)
      slide.head.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        easing: calm,
      });
  }, [collapsed, slide.head]);
  // In the rail head it is a ghost icon; in the top bar it matches the
  // Edit button beside it.
  const railToggle = (
    className?: string,
    ref?: RefObject<HTMLButtonElement | null>,
    inBar = false,
  ) => {
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
    const props = {
      ref,
      "aria-label": label,
      "aria-expanded": !collapsed,
      "aria-controls": "typren-rail",
      onClick: toggleRail,
    };
    // While the peek is open the button has done its job, and its tooltip
    // would cover the peek's title.
    return (
      <Tooltip disabled={inBar && peek}>
        <TooltipTrigger
          render={
            inBar ? (
              <TopBarButton {...props} className={className} />
            ) : (
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                // Ghost marks an open popup with a fill; an expanded rail is not one.
                className={cn(
                  "aria-expanded:bg-transparent aria-expanded:hover:bg-[var(--typren-fill-subtle-hover)]",
                  className,
                )}
              />
            )
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent container={portal} side="bottom">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };
  const head = back ? (
    <Button
      variant="ghost"
      onClick={back.onBack}
      className="min-w-0 pr-4 pl-2 text-[17px] font-semibold text-[var(--typren-fg)]"
    >
      <ChevronLeft aria-hidden />
      <span className="truncate">{back.label}</span>
    </Button>
  ) : (
    <span className="flex items-center gap-2 px-2">
      <TyprenMark />
      <span className="text-lg font-medium tracking-tight">Typren</span>
    </span>
  );
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = `${title} · Typren Studio`;
    return () => {
      document.title = before;
    };
  }, [title]);
  return (
    <PortalContext value={portal}>
      <AnnounceContext value={setLive}>
        <PillAnnouncer status={pill?.status ?? ""} />
        <div
          ref={reveal}
          className={cn(
            "typren-smooth typren-surface-0 relative flex h-full min-h-0 flex-col overflow-clip overscroll-none bg-[var(--typren-bg-base)] text-[var(--typren-fg)]",
            // A light studio pins `light` so native controls don't follow a dark OS
            // through the host's `color-scheme: light dark`; `.dark` sets its own.
            dark ? "dark" : "[color-scheme:light]",
          )}
          onKeyDown={(e) => {
            if (e.key === "Escape" && railOpen) {
              setRailOpen(false);
              menu.current?.focus();
            } else if (e.key === "Escape" && peek) {
              setPeek(false);
              armed.current = false;
              expand.current?.focus();
            }
          }}
        >
          {/* The one polite live region: save, publish and push results land here, not just in the pill. */}
          <div role="status" aria-live="polite" className="sr-only">
            {live}
          </div>
          <a
            href="#typren-main"
            onClick={(e) => (
              e.preventDefault(),
              document.getElementById("typren-main")?.focus()
            )}
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-[var(--typren-radius-control)] focus:bg-[var(--typren-card)] focus:px-3 focus:py-2 focus:text-sm focus:shadow-(--typren-shadow-flyout)"
          >
            Skip to content
          </a>
          {/* The top bar's first and last controls line up with the preview
              card's edges in every layout: the bar and the main area share one
              inset (px-2, md:px-4, none beside a pinned rail), and the pinned
              rail's column gives back the bar's column gap, so the first
              control starts where the rail ends, as the card does. The cells
              either side of the search reserve the same width (`useBarLayout`),
              so the pill stays centred over the card in browse and edit mode. */}
          <header
            className={cn(
              "relative flex shrink-0 items-center gap-2 px-2 py-2 md:grid md:h-16 md:gap-3 md:py-0 md:pr-4",
              collapsed
                ? "md:grid-cols-[minmax(var(--side),1fr)_minmax(0,29.5rem)_minmax(var(--side),1fr)] md:pl-4"
                : "md:grid-cols-[calc(18rem-0.75rem)_minmax(var(--side),1fr)_minmax(0,29.5rem)_minmax(var(--side),1fr)] md:pl-0",
            )}
            // Measured, so it can only arrive as a value; max-content until then.
            style={{ "--side": side ? `${side}px` : "max-content" } as CSSProperties}
          >
            <div
              // Below md the menu button lines up with the preview card's left edge.
              className={cn("flex min-w-0 items-center md:pl-3", collapsed && "md:hidden")}
            >
              <TopBarButton
                ref={menu}
                aria-label="Menu"
                aria-expanded={railOpen}
                onClick={() => setRailOpen((o) => !o)}
                className="mr-2 md:hidden"
              >
                <Menu />
              </TopBarButton>
              {/* Only the lockup or Back slides and fades: the collapse button
                  beside it, like the rail's theme picker, stays still. */}
              <span ref={slide.head} className="hidden min-w-0 md:flex">
                {head}
              </span>
              {!collapsed && railToggle("ml-auto hidden md:inline-flex")}
            </div>
            {/* Below md: the mark alone, truly centred between menu and actions. */}
            <span
              role="img"
              aria-label="Typren"
              className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 md:hidden"
            >
              <TyprenMark />
            </span>
            <div
              data-rail-flip
              className="flex min-w-0 items-center gap-2 max-md:order-2"
            >
              {collapsed && (
                <span
                  className="hidden md:flex"
                  onPointerEnter={peekFromTrigger}
                  onPointerLeave={leaveTrigger}
                  onFocus={peekFromTrigger}
                  onBlur={leaveTrigger}
                >
                  {railToggle(undefined, expand, true)}
                </span>
              )}
              <ActionMorph morphed={inline} tools={tools}>
                <ControlSwap id={actions ? "actions" : ""} className="justify-start">
                  {actions}
                </ControlSwap>
                {inline && (
                  <div ref={tools} id="typren-edit-row" role="group" aria-label="Edit" className="flex shrink-0 items-center gap-2">
                    {toolbar}
                  </div>
                )}
              </ActionMorph>
            </div>
            <div
              ref={searchCell}
              data-rail-flip
              // A container: the pill fills it up to its max width, and gives way
              // to an icon button that opens the search sheet once the cell is
              // too narrow for it (always, on a phone).
              className="@container flex min-w-0 justify-center max-md:order-1 max-md:ml-auto max-md:w-[var(--typren-control-h)]"
            >
              {search ? (
                <>
                  <div className="hidden w-full max-w-[29.5rem] @[16rem]:flex">
                    <SearchBox pill={pill} search={search} />
                  </div>
                  <div className="mr-auto flex @[16rem]:hidden">
                    <SearchSheet search={search} locale={locale} />
                  </div>
                </>
              ) : (
                // A phone's cell holds one button's width, which the pill
                // can't fill: its status is announced (`PillAnnouncer`), not shown.
                pill && (
                  <div aria-label="Current page" className={cn(pillClass, "max-w-[29.5rem] max-md:hidden")}>
                    <PillContent pill={pill} />
                  </div>
                )
              )}
            </div>
            <div
              data-rail-flip
              // Gone below md while it holds nothing shown, so its gap doesn't
              // push the actions off the preview card's right edge.
              className="flex items-center justify-end gap-2 max-md:order-3 max-md:not-has-[>:not(.hidden)]:hidden"
            >
              {locale && (
                <span className="hidden md:flex">
                  <LocaleSelect {...locale} />
                </span>
              )}
              {/* A phone shows the preview at its own width; presets would only mislead. */}
              <ControlSwap
                id={device ? "device" : controls ? "view" : ""}
                className={cn(device && "hidden md:flex")}
              >
                {device ? (
                  <DeviceToggle device={device} onChange={onDevice} />
                ) : (
                  controls
                )}
              </ControlSwap>
              {topBarSlot}
            </div>
          </header>
          {banner}
          <div className="flex min-h-0 flex-1">
            {/* Kept mounted, so the drawer and its scrim can fade out as well as in. */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close menu"
              aria-hidden={!railOpen}
              inert={!railOpen}
              onClick={() => setRailOpen(false)}
              className={cn(
                "fixed inset-0 z-30 bg-[var(--typren-smoke)] transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none md:hidden",
                !railOpen && "pointer-events-none opacity-0",
              )}
            />
            <nav
              ref={nav}
              id="typren-rail"
              data-rail-flip
              aria-label="Studio"
              // Hidden off-canvas while collapsed: out of the tab order too. The
              // closed drawer below md is `invisible`, which does the same.
              inert={collapsed && !peek && !railOpen}
              onPointerEnter={collapsed ? showPeek : undefined}
              onPointerLeave={collapsed ? hidePeek : undefined}
              onBlur={collapsed ? hidePeek : undefined}
              className={cn(
                // Below md a drawer; visibility rides the transition, so it
                // hides only once the slide out has finished.
                // Its own frame grain: as a layer (a transform or fixed position)
                // it paints over the root's, and would read as a darker slab.
                "typren-surface-0 fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shrink-0 flex-col bg-[var(--typren-bg-base)] shadow-(--typren-shadow-flyout) transition-[translate,opacity,visibility] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none md:visible md:max-w-none",
                !railOpen && "invisible -translate-x-full opacity-0",
                collapsed
                  ? cn(
                      "md:absolute md:bottom-4 md:left-2 md:top-16 md:overflow-clip md:rounded-[var(--typren-radius-card)] md:ring-1 md:ring-[var(--typren-stroke-flyout)]",
                      peek
                        ? "md:translate-x-0 md:opacity-100"
                        : "md:-translate-x-[calc(100%+1rem)] md:opacity-0",
                    )
                  : // Pinning glides the rail in with the content (FLIP), not by transition.
                    "md:relative md:z-auto md:translate-x-0 md:opacity-100 md:shadow-none md:transition-none",
              )}
            >
              {/* The open drawer below md leads with the lockup (or Back). The desktop
                  peek shows the rail alone: no lockup or toggle, only Back when drilled in. */}
              {(railOpen || (collapsed && back)) && (
                <div
                  className={cn(
                    "flex h-14 shrink-0 items-center px-3",
                    !(collapsed && back) && "md:hidden",
                  )}
                >
                  {head}
                </div>
              )}
              <ScrollArea className="min-h-0 flex-1">
                {/* The scroller sizes its content to fit-content, so a long title would widen it; pin the rail's own width. */}
                <div
                  ref={slide.rail}
                  className="w-72"
                  onClick={() => setRailOpen(false)}
                >
                  {rail}
                </div>
              </ScrollArea>
              {/* ponytail: a stopgap theme picker until the studio has a settings menu to hold it. */}
              <ToggleGroup
                aria-label="Studio theme"
                value={[dark ? "dark" : "light"]}
                onValueChange={([next]) =>
                  next && (next === "dark") !== dark && onToggleTheme()
                }
                className="m-3 self-start"
              >
                <ToggleGroupItem value="light" aria-label="Light">
                  <Sun className="size-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label="Dark">
                  <Moon className="size-4" />
                </ToggleGroupItem>
              </ToggleGroup>
            </nav>
            <main
              ref={main}
              id="typren-main"
              data-rail-flip
              tabIndex={-1}
              className={cn(
                // Below md the card sits the same 0.5rem in on three sides, the
                // bottom clear of the home indicator.
                "outline-none flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pb-4 md:pr-4",
                collapsed ? "md:pl-4" : "md:pl-0",
              )}
            >
              {title && <h1 className="sr-only">{title}</h1>}
              <ToolbarRow tools={tools}>
                {!inline && toolbar && (
                  <>
                    {toolbar}
                    {/* A phone's home for the switcher while editing. */}
                    {locale && (
                      <span className="flex md:hidden">
                        <LocaleSelect {...locale} />
                      </span>
                    )}
                  </>
                )}
              </ToolbarRow>
              <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
            </main>
          </div>
          <div ref={setPortal} className="contents" />
        </div>
      </AnnounceContext>
    </PortalContext>
  );
}
