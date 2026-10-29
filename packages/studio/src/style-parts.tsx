"use client";

import { useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { X } from "lucide-react";
import { STYLE_TOKENS, sanitizeStyle } from "@typren/core";
import type { StyleToken, StyleTokenKind } from "@typren/core";
import { useSelection } from "./asset-browser";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { Input } from "./primitives/input";
import { Field } from "./primitives/field";
import { ScrollArea } from "./primitives/scroll-area";

/** What every Style screen gets: the draft tokens, a setter ("" unsets), the
 *  site's own values (what an unset token falls back to), and `stage`, the
 *  site preview, shown in place of the gallery while `preview` is on. */
export type StyleScreenProps = Readonly<{
  style: Record<string, string>;
  site?: Record<string, string>;
  set: (name: string, value: string) => void;
  stage?: ReactNode;
  preview?: boolean;
}>;

/** A token's value as shown: the draft's, else the site's labelled as such,
 *  else "Not set" (with what the screen draws instead, when it draws one). */
export function Shown({
  value,
  site,
  shown,
}: Readonly<{ value?: string; site?: string; shown?: string }>) {
  if (value)
    return <span className="truncate text-[var(--typren-fg)]">{value}</span>;
  if (site)
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-[var(--typren-fg)]">{site}</span>
        <span className="shrink-0 font-sans text-[11px] text-[var(--typren-muted-fg)]">
          From site
        </span>
      </span>
    );
  return (
    <span className={NOT_SET}>Not set{shown && ` (shown at ${shown})`}</span>
  );
}

export const token = (name: string): StyleToken =>
  STYLE_TOKENS.find((t) => t.name === name)!;

/** `style` with `name` set to `value`, or unset when `value` is empty. */
export function withToken(
  style: Record<string, string>,
  name: string,
  value: string,
): Record<string, string> {
  const next = { ...style };
  delete next[name];
  if (value) next[name] = value;
  return next;
}

// The property each kind is checked against with `CSS.supports`.
const PROPERTY: Record<StyleTokenKind, string> = {
  color: "color",
  text: "font-family",
  length: "width",
  number: "line-height",
};
const INVALID: Record<StyleTokenKind, string> = {
  color: "Not a colour. Try #1a73e8, rgb(26 115 232) or oklch(0.55 0.2 260).",
  text: "Not a font family.",
  length: "Not a length. Try 8px or 0.5rem.",
  number: "Not a number. Try 1.5.",
};

/** Why `value` can't be saved for `tok`, or null when it can (empty unsets).
 *  The stylesheet rule is `sanitizeStyle`'s; the type check is the browser's
 *  own parser, skipped where there is none. */
export function tokenError(tok: StyleToken, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!sanitizeStyle({ [tok.name]: v })[tok.name])
    return "That value can’t go in a stylesheet.";
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    !CSS.supports(PROPERTY[tok.kind], v)
  )
    return INVALID[tok.kind];
  return null;
}

/** A gallery tile, styled like an asset tile: a grey box when selected, a
 *  lighter one on hover. */
export const tileClass = (selected: boolean) =>
  cn(
    "group flex cursor-pointer flex-col gap-2 rounded-[var(--typren-radius-card)] p-(--typren-inset-card) text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] motion-reduce:transition-none",
    selected
      ? "typren-selected relative bg-[var(--typren-fill-subtle-selected)]"
      : "hover:bg-[var(--typren-fill-subtle-hover)]",
  );

/** A tile's name, filled when selected, like an asset's name pill. */
export const nameClass = (selected: boolean) =>
  cn(
    "self-start rounded-[var(--typren-radius-sm)] px-1.5 font-sans text-sm font-medium",
    selected
      ? "bg-[var(--typren-fg)] text-[var(--typren-card)]"
      : "text-[var(--typren-fg)]",
  );

export const NOT_SET = "italic text-[var(--typren-muted-fg)]";

/** The gallery's selection (see `useSelection`): Enter or a double click
 *  moves focus into the side panel, which opens for whatever is selected. */
export function useStyleSelection(keys: string[]) {
  const aside = useRef<HTMLElement>(null);
  const focusAside = () =>
    aside.current
      ?.querySelector<HTMLElement>("input,button:not([aria-label='Close'])")
      ?.focus();
  return { ...useSelection(keys, focusAside, () => {}), aside };
}

/** A Style screen: the gallery (or `stage`) with the side panel floating
 *  over its right edge while something is selected. The gallery keeps
 *  clear of the panel, so no tile hides under it. */
export function StyleScreen({
  label,
  stage,
  preview,
  aside,
  onClear,
  onKeyDown,
  children,
}: Readonly<{
  label: string;
  stage?: ReactNode;
  preview?: boolean;
  aside: ReactNode;
  onClear: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  children: ReactNode;
}>) {
  // Reserved whether or not the panel is open, so selecting a tile never reflows the grid under the pointer.
  const room = "pr-[calc(20rem+1.5rem)]";
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* The preview stays mounted while hidden: it is also where the site's
          own values are read from. */}
      {stage && (
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 p-3",
            room,
            !preview && "hidden",
          )}
        >
          {stage}
        </div>
      )}
      {!preview && (
        <ScrollArea
          aria-label={label}
          className="min-h-0 min-w-0 flex-1"
          viewportClassName={cn("p-6", room)}
          onClick={onClear}
          onKeyDown={onKeyDown}
        >
          {children}
        </ScrollArea>
      )}
      {aside}
    </div>
  );
}

/** The side panel, in the asset viewer's floating-panel language. It slides
 *  in once when something is first selected and keeps its place while the
 *  selection moves. */
export function StyleAside({
  ref,
  title,
  subtitle,
  onClose: close,
  children,
}: Readonly<{
  ref: Ref<HTMLElement>;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}>) {
  // Closing hands focus back to the selected tile instead of dropping it on <body>.
  const onClose = () => {
    const tile = document.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    tile?.focus(); // before closing: the tile's onFocus selects it, then close clears that
    close();
  };
  return (
    <aside
      ref={ref}
      aria-label={`${title} settings`}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="typren-surface-2 absolute bottom-3 right-3 top-3 z-10 w-80 overflow-hidden rounded-[var(--typren-radius-card)] bg-[var(--typren-card)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)] transition duration-300 ease-out starting:translate-x-4 starting:opacity-0 motion-reduce:transition-none"
    >
      <ScrollArea className="size-full" viewportClassName="p-5">
        <div className="flex flex-col gap-6">
          <header className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-[var(--typren-fg)]">
                {title}
              </h2>
              <p className="truncate font-mono text-xs text-[var(--typren-muted-fg)]">
                {subtitle}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={onClose}
            >
              <X />
            </Button>
          </header>
          {children}
        </div>
      </ScrollArea>
    </aside>
  );
}

/** A labelled text field for one token, with its validation message. */
export function TokenField({
  tok,
  value,
  site,
  set,
  placeholder,
  hint,
  inputMode,
  before,
}: Readonly<{
  tok: StyleToken;
  value: string;
  /** The site's own value, shown while the token is unset. */
  site?: string;
  set: (name: string, value: string) => void;
  placeholder?: string;
  hint?: string;
  inputMode?: "decimal" | "text";
  before?: ReactNode;
}>) {
  const error = tokenError(tok, value);
  hint =
    !value && site
      ? "Showing the site’s own value. Type to override it."
      : hint;
  const id = `typren-style-${tok.name.slice(2)}`;
  return (
    <Field label={tok.label} htmlFor={id} note={error ?? hint} error={!!error}>
      <div className="flex items-center gap-2">
        {before}
        <Input
          id={id}
          value={value}
          inputMode={inputMode}
          spellCheck={false}
          placeholder={site || placeholder || "Not set"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          onChange={(e) => set(tok.name, e.target.value)}
          className="font-mono text-sm"
        />
      </div>
    </Field>
  );
}

/** One-click values for a token, each shown in its own terms by `render`. */
export function Presets({
  label,
  values,
  current,
  onPick,
  render,
}: Readonly<{
  label: string;
  values: readonly { name: string; value: string }[];
  current: string;
  onPick: (value: string) => void;
  render?: (value: string) => ReactNode;
}>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {values.map((p) => (
        <button
          key={p.name}
          type="button"
          aria-pressed={current === p.value}
          onClick={() => onPick(p.value)}
          className="flex cursor-pointer items-center gap-1.5 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] px-2.5 py-1 text-xs text-[var(--typren-fg)] shadow-(--typren-elevation) outline-none transition-colors duration-150 hover:bg-[var(--typren-fill-control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] aria-pressed:bg-[var(--typren-fill-subtle-selected)] motion-reduce:transition-none"
        >
          {render?.(p.value)}
          {p.name}
        </button>
      ))}
    </div>
  );
}

/** Unsets `names`; disabled while none of them is set. */
export function ResetButton({
  names,
  style,
  set,
}: Readonly<{
  names: string[];
  style: Record<string, string>;
  set: (name: string, value: string) => void;
}>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      disabled={!names.some((n) => style[n])}
      onClick={() => names.forEach((n) => set(n, ""))}
    >
      Reset to default
    </Button>
  );
}
