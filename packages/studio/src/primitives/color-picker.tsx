"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Slider } from "@base-ui/react/slider";
import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { usePortal } from "./portal";

/** sRGB bytes and an alpha from 0 to 1. */
export type Rgba = readonly [number, number, number, number];
/** Hue in degrees; saturation, value (brightness) and alpha in percent. */
type Hsva = { h: number; s: number; v: number; a: number };

const clamp = (n: number, max = 100) => Math.min(max, Math.max(0, n));

export function toHsva([r, g, b, a]: Rgba): Hsva {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  const h = d === 0 ? 0 : max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? (d / max) * 100 : 0, v: max * 100, a: a * 100 };
}

export function toRgba({ h, s, v, a }: Hsva): Rgba {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v / 100) * (1 - (s / 100) * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return [f(5), f(3), f(1), a / 100];
}

/** `#rrggbb`, or `#rrggbbaa` when not opaque: plain hex always passes
 *  `sanitizeStyle` and every engine parses it. */
export function rgbaHex([r, g, b, a]: Rgba): string {
  const bytes = a < 1 ? [r, g, b, Math.round(a * 255)] : [r, g, b];
  return `#${bytes.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// The colour model's own gradients, not theme: a hue wheel unrolled, and
// HSV's white and black ramps. They stay literal in both studio themes.
const HUES = "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";
const RAMPS = "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)";
const CHECKER: CSSProperties = {
  backgroundImage: "repeating-conic-gradient(var(--typren-fill-subtle-selected) 0 25%, transparent 0 50%)",
  backgroundSize: "8px 8px",
};
// A light ring inside a dark one (the studio's own bg and fg, which always
// oppose), so a handle reads on any colour without relying on hue.
const HANDLE =
  "block size-4 rounded-full shadow-[0_0_0_2px_var(--typren-bg),0_0_0_3px_var(--typren-fg)] outline-none has-[:focus-visible]:shadow-[0_0_0_2px_var(--typren-bg),0_0_0_3px_var(--typren-fg),0_0_0_5px_var(--typren-ring)]";

function Track({ label, value, max, text, onChange, style }: Readonly<{ label: string; value: number; max: number; text: (v: number) => string; onChange: (v: number) => void; style: CSSProperties }>) {
  return (
    <Slider.Root value={value} min={0} max={max} largeStep={10} onValueChange={(v) => onChange(v as number)}>
      <Slider.Control className="flex h-5 touch-none items-center">
        <Slider.Track className="h-3 w-full rounded-full ring-1 ring-inset ring-[var(--typren-stroke-card)]" style={style}>
          <Slider.Thumb aria-label={label} getAriaValueText={(_, v) => text(v)} className={HANDLE} />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}

/**
 * A colour picker in a popover: a saturation and brightness area, hue and
 * opacity sliders, and optional preset swatches. It writes hex; a text field
 * beside the trigger keeps every other syntax. `color` is what the field
 * holds now, or null for nothing or a value no canvas can read.
 *
 * Keyboard: in the area, ←/→ change saturation and ↑/↓ brightness; on the
 * sliders, the arrows step by 1. Shift steps by 10 everywhere.
 */
export function ColorPicker({
  label,
  color,
  onChange,
  presets = [],
}: Readonly<{ label: string; color: Rgba | null; onChange: (value: string) => void; presets?: readonly string[] }>) {
  const portal = usePortal();
  const [open, setOpen] = useState(false);
  const [hsva, setHsva] = useState(() => toHsva(color ?? [0, 0, 0, 1]));
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // The hex last written. A new value from outside resets the model; our own
  // echo doesn't, so hue survives a drag through grey, where hex forgets it.
  const emitted = useRef<string | null>(null);
  const hex = color && rgbaHex(color);
  useEffect(() => {
    if (hex !== emitted.current) setHsva(toHsva(color ?? [0, 0, 0, 1]));
    // `hex` stands for `color`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  const update = (next: Partial<Hsva>) => {
    const n = { ...hsva, ...next };
    setHsva(n);
    emitted.current = rgbaHex(toRgba(n));
    onChange(emitted.current);
  };

  const fromPointer = (e: PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    update({ s: clamp(((e.clientX - r.left) / (r.width || 1)) * 100), v: clamp(100 - ((e.clientY - r.top) / (r.height || 1)) * 100) });
  };
  const onAreaKey = (e: KeyboardEvent) => {
    const k = e.shiftKey ? 10 : 1;
    const d = ({ ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] } as Record<string, [number, number]>)[e.key];
    if (!d) return;
    e.preventDefault();
    update({ s: clamp(Math.round(hsva.s) + d[0]), v: clamp(Math.round(hsva.v) + d[1]) });
  };

  const [r, g, b] = toRgba({ ...hsva, a: 100 });
  const opaque = `rgb(${r} ${g} ${b})`;
  const s = Math.round(hsva.s);
  const v = Math.round(hsva.v);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${label} picker`}
        className="relative size-[var(--typren-control-h)] shrink-0 cursor-pointer rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] shadow-(--typren-elevation) outline-none transition-colors duration-150 [--typren-inset:4px] [--typren-radius-outer:var(--typren-radius-control)] hover:bg-[var(--typren-fill-control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] motion-reduce:transition-none"
      >
        <span className="typren-concentric absolute inset-1 overflow-hidden ring-1 ring-inset ring-[var(--typren-stroke-card)]" style={CHECKER}>
          <span className="block size-full" style={{ background: color ? rgbaHex(color) : undefined }} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        aria-label={`${label} colour picker`}
        container={portal ?? undefined}
        align="start"
        className="w-64 gap-3"
        initialFocus={area}
        // Escape closes this popover alone, not the side panel it opens from.
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false))}
      >
        <div
          ref={area}
          role="slider"
          tabIndex={0}
          aria-roledescription="2D slider"
          aria-label={`${label} saturation and brightness`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={s}
          aria-valuetext={`Saturation ${s}%, brightness ${v}%`}
          onKeyDown={onAreaKey}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            e.currentTarget.focus();
            fromPointer(e);
          }}
          onPointerMove={(e) => dragging.current && fromPointer(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          className="relative h-40 touch-none cursor-crosshair rounded-[var(--typren-radius-control)] outline-none ring-1 ring-inset ring-[var(--typren-stroke-card)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]"
          style={{ background: `${RAMPS}, hsl(${hsva.h} 100% 50%)` }}
        >
          <span
            aria-hidden
            className={cn(HANDLE, "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2")}
            style={{ left: `${hsva.s}%`, top: `${100 - hsva.v}%`, background: opaque }}
          />
        </div>
        <Track label={`${label} hue`} value={Math.round(hsva.h)} max={360} text={(h) => `${h} degrees`} onChange={(h) => update({ h })} style={{ background: HUES }} />
        <Track
          label={`${label} opacity`}
          value={Math.round(hsva.a)}
          max={100}
          text={(a) => `${a}%`}
          onChange={(a) => update({ a })}
          style={{ backgroundImage: `linear-gradient(to right, transparent, ${opaque}), ${CHECKER.backgroundImage}`, backgroundSize: "100% 100%, 8px 8px" }}
        />
        {presets.length > 0 && (
          <div role="group" aria-label="Site colours" className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                aria-label={`Use ${p}`}
                title={p}
                onClick={() => ((emitted.current = null), onChange(p))}
                className="size-6 cursor-pointer rounded-[var(--typren-radius-sm)] outline-none ring-1 ring-inset ring-[var(--typren-stroke-card)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]"
                style={{ background: p }}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
