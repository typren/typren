"use client";

import type { CSSProperties } from "react";
import { cn } from "./primitives/cn";
import {
  Presets,
  ResetButton,
  Shown,
  StyleAside,
  StyleScreen,
  TokenField,
  nameClass,
  tileClass,
  token,
  useStyleSelection,
  type StyleScreenProps,
} from "./style-parts";

const BODY = "--typren-font-body";
const HEADING = "--typren-font-heading";
const SIZE = "--typren-font-size";
const LINE = "--typren-line-height";
const HEADING_LINE = "--typren-heading-line-height";
const SCALE = "--typren-type-scale";

/** System stacks: they render everywhere with no web font to load. */
export const FONT_PRESETS = [
  { name: "System sans", value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { name: "Humanist", value: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, sans-serif' },
  { name: "Serif", value: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif' },
  { name: "Mono", value: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace' },
] as const;

/** `value` in px for the specimen's labels: px as is, rem and em at the
 *  browser's 16px. Null for anything else (a clamp(), a percentage). */
export function toPx(value: string | undefined): number | null {
  const m = /^(\d*\.?\d+)(px|rem|em)$/.exec(value?.trim() ?? "");
  if (!m) return null;
  return Number(m[1]) * (m[2] === "px" ? 1 : 16);
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : fallback;
};

const PANGRAM = "The quick brown fox jumps over the lazy dog.";
const PARAGRAPH = `${PANGRAM} Pack my box with five dozen liquor jugs, then sphinx of black quartz, judge my vow. Good type disappears into the reading, and these lines show how the body copy sets at the site's own size and line height.`;

/** What the specimen renders while a token is unset. The labels say "Not
 *  set" rather than claim these are the site's values. */
const DEFAULTS = { size: 16, line: 1.5, headingLine: 1.2, scale: 1.25 };

const GENERIC = /\b(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)\s*$/;

/** The family to draw `name` in. A site's web font is not loaded in the
 *  studio, so a stack with no generic family gets the system one to fall to. */
function family(style: Record<string, string>, name: string): CSSProperties["fontFamily"] {
  const f = style[name] || (name === HEADING ? style[BODY] : undefined);
  return f ? (GENERIC.test(f) ? f : `${f}, system-ui, sans-serif`) : undefined;
}

function Meta({ label, value, site, shown }: Readonly<{ label: string; value?: string; site?: string; shown?: string }>) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 whitespace-nowrap text-[var(--typren-muted-fg)]">{label}</span>
      <Shown value={value} site={site} shown={shown} />
    </span>
  );
}

/** Heading levels 1 to 4 at the base size times the scale, h4 one step up. */
export function headingSizes(style: Record<string, string>): { level: number; px: number }[] {
  const base = toPx(style[SIZE]) ?? DEFAULTS.size;
  const scale = num(style[SCALE], DEFAULTS.scale);
  return [1, 2, 3, 4].map((level) => ({ level, px: Math.round(base * scale ** (5 - level)) }));
}

const ITEMS = ["headings", "body"] as const;
type Item = (typeof ITEMS)[number];
const NAMES: Record<Item, string[]> = { headings: [HEADING, SCALE, HEADING_LINE], body: [BODY, SIZE, LINE] };

/**
 * Style → Type: a specimen of the site's headings and body copy, set large in
 * the site's fonts at its sizes. Selecting one opens its fonts, size and
 * line height beside it, with a live sample.
 */
export function TypeScreen({ style: draft, site = {}, set, stage, preview }: StyleScreenProps) {
  const { selected, setSelected, item, onKeyDown, aside } = useStyleSelection([...ITEMS]);
  const sel = selected as Item | null;
  // Drawn with the draft over the site's own values; fields edit the draft.
  const style = { ...site, ...draft };
  const headingLine = num(style[HEADING_LINE], DEFAULTS.headingLine);
  const bodySize = toPx(style[SIZE]) ?? DEFAULTS.size;
  const bodyLine = num(style[LINE], DEFAULTS.line);
  const glyph = (name: string) => (
    <span aria-hidden className="w-28 shrink-0 text-7xl leading-none text-[var(--typren-fg)]" style={{ fontFamily: family(style, name) }}>
      Aa
    </span>
  );

  return (
    <StyleScreen
      label="Type specimen"
      stage={stage}
      preview={preview}
      onClear={() => setSelected(null)}
      onKeyDown={onKeyDown}
      aside={
        sel && (
          <StyleAside ref={aside} title={sel === "headings" ? "Headings" : "Body"} subtitle={NAMES[sel].join(", ")} onClose={() => setSelected(null)}>
            <p
              className="rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] p-4 text-[var(--typren-fg)] shadow-(--typren-elevation)"
              style={
                sel === "headings"
                  ? { fontFamily: family(style, HEADING), fontSize: 28, lineHeight: headingLine, fontWeight: 600 }
                  : { fontFamily: family(style, BODY), fontSize: bodySize, lineHeight: bodyLine }
              }
            >
              {PANGRAM}
            </p>
            <div className="flex flex-col gap-2">
              <TokenField tok={token(NAMES[sel][0]!)} value={draft[NAMES[sel][0]!] ?? ""} site={site[NAMES[sel][0]!]} set={set} placeholder="Inter, sans-serif" />
              <Presets
                label="Font presets"
                values={FONT_PRESETS}
                current={draft[NAMES[sel][0]!] ?? ""}
                onPick={(v) => set(NAMES[sel][0]!, v)}
                render={(v) => <span style={{ fontFamily: v }}>Aa</span>}
              />
            </div>
            {sel === "headings" ? (
              <>
                <TokenField tok={token(SCALE)} value={draft[SCALE] ?? ""} site={site[SCALE]} set={set} inputMode="decimal" placeholder={String(DEFAULTS.scale)} hint="Each heading level is the one below it times this." />
                <TokenField tok={token(HEADING_LINE)} value={draft[HEADING_LINE] ?? ""} site={site[HEADING_LINE]} set={set} inputMode="decimal" placeholder={String(DEFAULTS.headingLine)} />
              </>
            ) : (
              <>
                <TokenField tok={token(SIZE)} value={draft[SIZE] ?? ""} site={site[SIZE]} set={set} placeholder="1rem" />
                <TokenField tok={token(LINE)} value={draft[LINE] ?? ""} site={site[LINE]} set={set} inputMode="decimal" placeholder={String(DEFAULTS.line)} />
              </>
            )}
            <ResetButton names={NAMES[sel]} style={draft} set={set} />
          </StyleAside>
        )
      }
    >
      <ul role="listbox" aria-label="Type" className="flex flex-col gap-4">
        <li role="option" aria-label="Headings" {...item("headings")} className={cn(tileClass(sel === "headings"), "gap-4 p-5")}>
          <div className="flex items-center gap-6">
            {glyph(HEADING)}
            <div className="flex min-w-0 flex-col gap-1 font-mono text-xs">
              <span className={nameClass(sel === "headings")}>Headings</span>
              <Meta label="Font" value={draft[HEADING]} site={site[HEADING]} shown={style[BODY] ? "the body font" : undefined} />
              <Meta label="Scale" value={draft[SCALE]} site={site[SCALE]} shown={String(DEFAULTS.scale)} />
              <Meta label="Line height" value={draft[HEADING_LINE]} site={site[HEADING_LINE]} shown={String(DEFAULTS.headingLine)} />
            </div>
          </div>
          {headingSizes(style).map(({ level, px }) => (
            <div key={level} className="flex min-w-0 items-baseline gap-4">
              <span className="w-28 shrink-0 font-mono text-xs text-[var(--typren-muted-fg)]">
                H{level} · {px}px / {headingLine}
              </span>
              <span
                className="min-w-0 truncate font-semibold text-[var(--typren-fg)]"
                style={{ fontFamily: family(style, HEADING), fontSize: px, lineHeight: headingLine }}
              >
                {PANGRAM}
              </span>
            </div>
          ))}
        </li>
        <li role="option" aria-label="Body" {...item("body")} className={cn(tileClass(sel === "body"), "gap-4 p-5")}>
          <div className="flex items-center gap-6">
            {glyph(BODY)}
            <div className="flex min-w-0 flex-col gap-1 font-mono text-xs">
              <span className={nameClass(sel === "body")}>Body</span>
              <Meta label="Font" value={draft[BODY]} site={site[BODY]} />
              <Meta label="Size" value={draft[SIZE]} site={site[SIZE]} shown={`${DEFAULTS.size}px`} />
              <Meta label="Line height" value={draft[LINE]} site={site[LINE]} shown={String(DEFAULTS.line)} />
            </div>
          </div>
          <div className="flex min-w-0 items-baseline gap-4">
            <span className="w-28 shrink-0 font-mono text-xs text-[var(--typren-muted-fg)]">
              {bodySize}px / {bodyLine}
            </span>
            <p className="max-w-[65ch] text-[var(--typren-fg)]" style={{ fontFamily: family(style, BODY), fontSize: bodySize, lineHeight: bodyLine }}>
              {PARAGRAPH}
            </p>
          </div>
        </li>
      </ul>
    </StyleScreen>
  );
}
