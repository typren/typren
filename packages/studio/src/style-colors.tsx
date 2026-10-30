"use client";

import type { CSSProperties } from "react";
import { STYLE_TOKENS } from "@typren/core";
import { cn } from "./primitives/cn";
import { ColorPicker } from "./primitives/color-picker";
import {
  NOT_SET,
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

export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/i;

/** A canvas resolves any colour syntax the browser knows (oklch, named,
 *  color-mix) to sRGB bytes. Null where there is no 2D canvas (tests, SSR). */
function viaCanvas(value: string): Rgb | null {
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  } catch {
    return null;
  }
  if (!ctx) return null;
  // An unparseable value leaves fillStyle as it was, so two different
  // starting points only agree when the value took.
  ctx.fillStyle = "#000";
  ctx.fillStyle = value;
  const a = ctx.fillStyle;
  ctx.fillStyle = "#fff";
  ctx.fillStyle = value;
  if (ctx.fillStyle !== a) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

const cache = new Map<string, Rgb | null>();

/** `value` as sRGB bytes, alpha ignored, or null when it isn't a colour. Hex
 *  and rgb() are read directly; anything else goes through a canvas. */
export function toRgb(value: string | undefined): Rgb | null {
  const v = value?.trim();
  if (!v) return null;
  if (cache.has(v)) return cache.get(v)!;
  const hex = HEX.exec(v)?.[1];
  const rgb = RGB.exec(v);
  const full = hex && (hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex);
  const out: Rgb | null = full
    ? ([0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as Rgb)
    : rgb
      ? ([1, 3, 5].map((i) => Math.round(Math.min(255, (Number(rgb[i]) * (rgb[i + 1] ? 255 : 100)) / 100))) as unknown as Rgb)
      : viaCanvas(v);
  // Only settled answers are kept: a canvas that wasn't there may be later.
  if (out || hex || rgb) cache.set(v, out);
  return out;
}

/** The alpha `value` carries, 0 to 1: a 4- or 8-digit hex, rgba()'s fourth
 *  argument, or any function's `/ alpha`. 1 when it carries none. */
export function alphaOf(value: string | undefined): number {
  const v = value?.trim() ?? "";
  const hex = HEX.exec(v)?.[1];
  if (hex && hex.length % 4 === 0) return parseInt(hex.length === 4 ? hex[3]!.repeat(2) : hex.slice(6), 16) / 255;
  const m = /\/\s*([\d.]+)(%?)\s*\)$/.exec(v) ?? /^rgba?\((?:[^,]*,){3}\s*([\d.]+)(%?)\s*\)$/i.exec(v);
  return m ? Math.min(1, Number(m[1]) / (m[2] ? 100 : 1)) : 1;
}

export const toHex = (rgb: Rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/** WCAG 2 relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The WCAG level `ratio` meets: text levels, or the 3:1 a border needs. */
export function grade(ratio: number, nonText = false): string {
  if (nonText) return ratio >= 3 ? "Pass" : "Fails";
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA Large" : "Fails";
}

/** `rgb` moved `amount` (0 to 1) of the way toward `to`. */
export const mix = (rgb: Rgb, to: Rgb, amount: number): Rgb => rgb.map((c, i) => Math.round(c + (to[i]! - c) * amount)) as unknown as Rgb;

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

// Palette groups, in reading order. A colour token the catalogue adds later
// and this list doesn't name lands under Other.
const GROUPS: { label: string; names: string[] }[] = [
  { label: "Brand", names: ["--typren-primary", "--typren-primary-fg", "--typren-secondary", "--typren-accent"] },
  { label: "Surfaces", names: ["--typren-bg", "--typren-muted"] },
  { label: "Text", names: ["--typren-fg"] },
  { label: "Borders", names: ["--typren-border"] },
];
const COLORS = STYLE_TOKENS.filter((t) => t.kind === "color").map((t) => t.name);
const listed = new Set(GROUPS.flatMap((g) => g.names));
const groups = [...GROUPS, { label: "Other", names: COLORS.filter((n) => !listed.has(n)) }]
  .map((g) => ({ ...g, names: g.names.filter((n) => COLORS.includes(n)) }))
  .filter((g) => g.names.length);
const KEYS = groups.flatMap((g) => g.names);

/** The pair each colour is read in: `fg` set on `bg`. A border is checked
 *  against the background it sits on. */
const PAIR: Record<string, { bg: string; fg: string }> = {
  "--typren-primary": { bg: "--typren-primary", fg: "--typren-primary-fg" },
  "--typren-primary-fg": { bg: "--typren-primary", fg: "--typren-primary-fg" },
  "--typren-secondary": { bg: "--typren-secondary", fg: "--typren-fg" },
  "--typren-accent": { bg: "--typren-accent", fg: "--typren-fg" },
  "--typren-bg": { bg: "--typren-bg", fg: "--typren-fg" },
  "--typren-muted": { bg: "--typren-muted", fg: "--typren-fg" },
  "--typren-fg": { bg: "--typren-bg", fg: "--typren-fg" },
  "--typren-border": { bg: "--typren-bg", fg: "--typren-border" },
};

/** Where an unset colour would be: diagonal stripes in the studio's own greys. */
const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--typren-fill-subtle-selected) 0 6px, transparent 6px 14px)",
};

type Reading = { ratio: number | null; partner: string; nonText: boolean };

function reading(name: string, style: Record<string, string>): Reading | null {
  const pair = PAIR[name];
  if (!pair) return null;
  const partner = pair.bg === name ? pair.fg : pair.bg;
  const a = toRgb(style[pair.bg]);
  const b = toRgb(style[pair.fg]);
  return { ratio: a && b ? contrast(a, b) : null, partner, nonText: name === "--typren-border" };
}

function Badge({ r, className }: Readonly<{ r: Reading; className?: string }>) {
  const text = r.ratio === null ? "—" : `${r.ratio.toFixed(1)}:1 ${grade(r.ratio, r.nonText)}`;
  return (
    <span
      title={r.ratio === null ? `${token(r.partner).label} is not set` : `Contrast against ${token(r.partner).label}`}
      className={cn(
        "rounded-full bg-[var(--typren-card)] px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--typren-fg)] shadow-(--typren-elevation)",
        r.ratio !== null && grade(r.ratio, r.nonText) === "Fails" && "text-[var(--typren-destructive)]",
        className
      )}
    >
      {text}
    </span>
  );
}

/** The pair rendered for real: the background colour with sample text set in
 *  the foreground colour. An unset side falls back to black or white,
 *  whichever reads, so the sample stays legible. */
function Sample({ name, style, big }: Readonly<{ name: string; style: Record<string, string>; big?: boolean }>) {
  const pair = PAIR[name]!;
  const bg = style[pair.bg];
  const fgRgb = toRgb(style[pair.fg]);
  const bgRgb = toRgb(bg);
  const fallback = bgRgb && contrast(bgRgb, BLACK) >= contrast(bgRgb, WHITE) ? "#000" : "#fff";
  const fg = fgRgb ? style[pair.fg] : fallback;
  const surface = pair.bg === name;
  return (
    <span
      className={cn("flex items-baseline gap-2 font-semibold", !surface && "typren-concentric px-3 py-2 shadow-(--typren-elevation)")}
      style={{ color: name === "--typren-border" ? style[pair.fg] : fg, background: surface ? undefined : bg || "#fff" }}
    >
      <span className={big ? "text-4xl" : "text-2xl"}>Aa</span>
      <span className="text-sm font-medium">{name === "--typren-border" ? "Border" : "Sample text"}</span>
    </span>
  );
}

function Swatch({ name, style, big }: Readonly<{ name: string; style: Record<string, string>; big?: boolean }>) {
  const value = style[name];
  const r = reading(name, style);
  return (
    <div
      className={cn(
        "relative flex flex-col justify-end overflow-hidden rounded-[var(--typren-radius-control)] p-4 [--typren-inset:16px] ring-1 ring-inset ring-[var(--typren-stroke-card)]",
        big ? "h-52" : "h-40"
      )}
      style={value ? { background: value } : HATCH}
    >
      {value ? (
        <>
          {r && <Sample name={name} style={style} big={big} />}
          {r && <Badge r={r} className="absolute right-3 top-3" />}
        </>
      ) : (
        <span className={cn("m-auto text-sm", NOT_SET)}>Not set</span>
      )}
    </div>
  );
}

/**
 * Style → Colors: the site's colour tokens as a large palette, grouped
 * brand, surfaces, text and borders, each swatch showing its pair's
 * contrast. Selecting one opens its settings beside the palette.
 */
export function ColorsScreen({ style, site = {}, set, stage, preview }: StyleScreenProps) {
  const { selected, setSelected, item, onKeyDown, aside } = useStyleSelection(KEYS);
  // What the site shows: the draft over the site's own values.
  const shown = { ...site, ...style };
  const tok = selected ? token(selected) : null;
  const value = selected ? (style[selected] ?? "") : "";
  const rgb = toRgb(selected ? shown[selected] : undefined);
  const r = selected ? reading(selected, shown) : null;
  // The site's own colours, offered as presets in the picker.
  const palette = [...new Set(KEYS.map((n) => site[n]).filter((v): v is string => Boolean(v)))];

  return (
    <StyleScreen
      label="Palette"
      stage={stage}
      preview={preview}
      onClear={() => setSelected(null)}
      onKeyDown={onKeyDown}
      aside={
        tok && (
          <StyleAside ref={aside} title={tok.label} subtitle={tok.name} onClose={() => setSelected(null)}>
            <TokenField
              tok={tok}
              value={value}
              site={site[tok.name]}
              set={set}
              before={
                <ColorPicker
                  label={tok.label}
                  color={rgb && [...rgb, alphaOf(selected ? shown[selected] : undefined)]}
                  onChange={(v) => set(tok.name, v)}
                  presets={palette}
                />
              }
            />
            {r && (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--typren-muted-fg)]">
                  Contrast against {token(r.partner).label}
                </h3>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--typren-fg)]">
                    {r.ratio === null ? "—" : `${r.ratio.toFixed(2)}:1`}
                  </span>
                  {r.ratio !== null && <Badge r={r} />}
                </div>
                <p className="text-xs text-[var(--typren-muted-fg)]">
                  {r.ratio === null
                    ? `Set ${token(r.partner).label} too to check this pair.`
                    : r.nonText
                      ? "Borders and controls need 3:1."
                      : "Body text needs 4.5:1 (AA); large text 3:1."}
                </p>
              </section>
            )}
            {rgb && (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--typren-muted-fg)]">Shades and tints</h3>
                <div className="flex overflow-hidden rounded-[var(--typren-radius-control)] ring-1 ring-[var(--typren-stroke-card)]">
                  {[-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6].map((k) => {
                    const hex = toHex(k < 0 ? mix(rgb, BLACK, -k) : mix(rgb, WHITE, k));
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-label={`Use ${hex}`}
                        title={hex}
                        onClick={() => set(tok.name, hex)}
                        style={{ background: hex }}
                        className={cn(
                          "h-10 flex-1 cursor-pointer outline-none hover:ring-2 hover:ring-inset hover:ring-[var(--typren-stroke-control-strong)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--typren-ring)]",
                          k === 0 && "flex-[1.4]"
                        )}
                      />
                    );
                  })}
                </div>
              </section>
            )}
            <ResetButton names={[tok.name]} style={style} set={set} />
          </StyleAside>
        )
      }
    >
      {/* The whole palette at a glance; each band selects its swatch. */}
      <div aria-hidden className="mb-8 flex h-20 overflow-hidden rounded-[var(--typren-radius-card)] ring-1 ring-[var(--typren-stroke-card)]">
        {KEYS.map((n, i) => (
          <div
            key={n}
            onClick={(e) => (e.stopPropagation(), setSelected(n))}
            style={shown[n] ? { background: shown[n] } : HATCH}
            className="relative flex-1 cursor-pointer"
          >
            {/* An inset ring of its own, so the strip's rounded clip never cuts
                it: the end bands take the strip's corners less the inset. */}
            {selected === n && (
              <span
                className={cn(
                  "pointer-events-none absolute inset-[3px] rounded-[var(--typren-radius-sm)] ring-2 ring-[var(--typren-ring)]",
                  i === 0 && "rounded-l-[calc(var(--typren-radius-card)-3px)]",
                  i === KEYS.length - 1 && "rounded-r-[calc(var(--typren-radius-card)-3px)]"
                )}
              />
            )}
          </div>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g.label} className="mb-8">
          <h2 className="mb-3 px-2 text-xs font-medium uppercase tracking-wide text-[var(--typren-muted-fg)]">{g.label}</h2>
          <ul role="listbox" aria-label={g.label} className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {g.names.map((n, i) => {
              const big = g.label === "Brand" && i === 0;
              return (
                <li key={n} role="option" aria-label={token(n).label} {...item(n)} className={cn(tileClass(selected === n), big && "sm:col-span-2")}>
                  <Swatch name={n} style={shown} big={big} />
                  <span className={nameClass(selected === n)}>{token(n).label}</span>
                  <span className="flex flex-col gap-0.5 px-1.5 font-mono text-xs">
                    <span className="truncate text-[var(--typren-muted-fg)]">{n}</span>
                    <Shown value={style[n]} site={site[n]} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </StyleScreen>
  );
}
