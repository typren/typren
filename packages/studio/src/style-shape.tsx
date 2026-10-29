"use client";

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

const RADIUS = "--typren-radius";
const SPACE = "--typren-space";

const PRESETS: Record<string, { name: string; value: string }[]> = {
  [RADIUS]: [
    { name: "Square", value: "0" },
    { name: "Soft", value: "4px" },
    { name: "Round", value: "8px" },
    { name: "Rounder", value: "16px" },
  ],
  [SPACE]: [
    { name: "Tight", value: "0.75rem" },
    { name: "Normal", value: "1rem" },
    { name: "Airy", value: "1.5rem" },
  ],
};

// The studio's neutral blocks, so the shapes read without the site's colours.
const BLOCK = "bg-[var(--typren-fill-control-solid)] ring-1 ring-[var(--typren-stroke-card)]";
// The site's own radius, drawn with the circular arcs the site draws, not the
// studio's squircles.
const SITE_SHAPE = "[corner-shape:round]";

/**
 * Style → Shape: the corner radius and base spacing, each drawn as shapes at
 * the site's value. Selecting one opens its value and presets beside it.
 */
export function ShapeScreen({ style, site = {}, set, stage, preview }: StyleScreenProps) {
  const { selected, setSelected, item, onKeyDown, aside } = useStyleSelection([RADIUS, SPACE]);
  const tok = selected ? token(selected) : null;
  const radius = style[RADIUS] || site[RADIUS] || "0";
  const space = style[SPACE] || site[SPACE] || "1rem";
  const meta = (name: string, shown: string) => (
    <span className="flex px-1.5 font-mono text-xs">
      <Shown value={style[name]} site={site[name]} shown={shown} />
    </span>
  );

  return (
    <StyleScreen
      label="Shape"
      stage={stage}
      preview={preview}
      onClear={() => setSelected(null)}
      onKeyDown={onKeyDown}
      aside={
        tok && (
          <StyleAside ref={aside} title={tok.label} subtitle={tok.name} onClose={() => setSelected(null)}>
            <TokenField tok={tok} value={style[tok.name] ?? ""} site={site[tok.name]} set={set} placeholder={tok.name === RADIUS ? "8px" : "1rem"} />
            <Presets label={`${tok.label} presets`} values={PRESETS[tok.name]!} current={style[tok.name] ?? ""} onPick={(v) => set(tok.name, v)} />
            <ResetButton names={[tok.name]} style={style} set={set} />
          </StyleAside>
        )
      }
    >
      <ul role="listbox" aria-label="Shape" className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
        <li role="option" aria-label={token(RADIUS).label} {...item(RADIUS)} className={tileClass(selected === RADIUS)}>
          <div className="flex h-48 items-end gap-4 rounded-[var(--typren-radius-control)] p-6 ring-1 ring-inset ring-[var(--typren-stroke-card)]">
            <div className={cn("size-28", BLOCK, SITE_SHAPE)} style={{ borderRadius: radius }} />
            <div className={cn("h-16 w-24", BLOCK, SITE_SHAPE)} style={{ borderRadius: radius }} />
            <div className={cn("h-9 w-20", BLOCK, SITE_SHAPE)} style={{ borderRadius: radius }} />
          </div>
          <span className={nameClass(selected === RADIUS)}>{token(RADIUS).label}</span>
          {meta(RADIUS, "0")}
        </li>
        <li role="option" aria-label={token(SPACE).label} {...item(SPACE)} className={tileClass(selected === SPACE)}>
          <div className="flex h-48 flex-col justify-center rounded-[var(--typren-radius-control)] p-6 ring-1 ring-inset ring-[var(--typren-stroke-card)]">
            {/* Gaps of one and two times the base. */}
            {[1, 2, 3].map((k) => (
              <div key={k} className="flex flex-col">
                <div className={cn("h-5 rounded-[var(--typren-radius-sm)]", BLOCK)} />
                {k < 3 && (
                  <div className="border-x border-dashed border-[var(--typren-muted-fg)] opacity-60" style={{ height: `calc(${space} * ${k})` }} />
                )}
              </div>
            ))}
          </div>
          <span className={nameClass(selected === SPACE)}>{token(SPACE).label}</span>
          {meta(SPACE, "1rem")}
        </li>
      </ul>
    </StyleScreen>
  );
}
