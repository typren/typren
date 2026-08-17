"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { FieldDef, Slice, SliceSchema } from "@typren/core";
import { fromYaml, toYaml } from "./yaml";
import { ImagePickerField, type FieldFormMedia } from "./image-picker-field";
import { IconPickerField, type FieldFormIcons } from "./icon-picker-field";
import { Button } from "./primitives/button";
import { cn } from "./primitives/cn";
import { Input } from "./primitives/input";
import { Label } from "./primitives/label";
import { Select } from "./primitives/select";
import { Textarea } from "./primitives/textarea";

/** Edit one array/object field as YAML, keeping a local buffer so invalid
 *  intermediate text doesn't get thrown away mid-edit. */
function YamlField({
  label,
  value,
  onCommit,
}: Readonly<{ label: string; value: unknown; onCommit: (v: unknown) => void }>) {
  const [text, setText] = useState(() => toYaml(value));
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Label>
        {label} <span className="text-[var(--typren-muted-fg)]">(YAML)</span>
      </Label>
      <Textarea
        className="min-h-24 font-mono text-xs"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const r = fromYaml(e.target.value);
          if (r.ok) {
            setError(null);
            onCommit(r.value);
          } else {
            setError(r.error);
          }
        }}
      />
      {error && <span className="mt-1 block text-xs text-[var(--typren-destructive)]">{error}</span>}
    </div>
  );
}

const isMultiline = (s: string) => s.length > 60 || s.includes("\n");

/** Which control to render: the schema hint wins, else infer from the value. */
function controlFor(def: FieldDef | undefined, value: unknown): NonNullable<FieldDef["type"]> {
  if (def?.type) return def.type;
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return isMultiline(value) ? "textarea" : "text";
  if (value === null || value === undefined) return "text";
  return "yaml"; // array | object
}

/** Shared capabilities threaded through every control renderer in this file —
 *  both the top-level field list and a slot's per-item field list need the
 *  same media/icons wiring, so this is one type instead of two call sites
 *  drifting apart. */
type FieldCapabilities = Readonly<{ media?: FieldFormMedia; icons?: FieldFormIcons }>;

/**
 * Renders ONE field's control. Callers own the `key` prop — this is used both
 * for a slice's top-level props (keyed by prop name) and for a slot item's own
 * fields (same keying, one level down). This is the piece "slot" recurses
 * through: an item field whose own type is "slot" calls back into `SlotField`
 * below, and `SlotField` calls back into this for each item's fields — mutual
 * recursion within one module, no import cycle.
 */
function FieldRow({
  fieldKey,
  def,
  value,
  onChange,
  onUnset,
  media,
  icons,
}: Readonly<
  {
    fieldKey: string;
    def: FieldDef | undefined;
    value: unknown;
    onChange: (v: unknown) => void;
    onUnset: () => void;
  } & FieldCapabilities
>): ReactNode {
  const label = def?.label ?? fieldKey;
  const control = controlFor(def, value);

  if (control === "select") {
    const current = typeof value === "string" ? value : "";
    const options = def?.options ?? [];
    return (
      <div>
        <Label>{label}</Label>
        <Select value={current} onChange={(e) => (e.target.value === "" ? onUnset() : onChange(e.target.value))}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {current && !options.includes(current) && (
            <option value={current}>{current} (custom)</option>
          )}
        </Select>
      </div>
    );
  }
  if (control === "color") {
    // Swatches show the ACTUAL color, not the word — the package can't know
    // the host's palette any more than its icon library, so each token
    // resolves through a host-defined `--typren-swatch-<token>` custom property.
    // A token with no matching variable falls back to `transparent`, not a crash.
    const current = typeof value === "string" ? value : "";
    const options = def?.options ?? [];
    return (
      <div>
        <Label>{label}</Label>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={current === o}
              aria-label={o}
              title={o}
              onClick={() => onChange(o)}
              className={cn(
                "size-7 rounded-full border-2 transition-shadow",
                current === o
                  ? "border-[var(--typren-ring)] shadow-[0_0_0_2px_var(--typren-bg)]"
                  : "border-[var(--typren-border)]"
              )}
              style={{ backgroundColor: `var(--typren-swatch-${o}, transparent)` }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (control === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-[var(--typren-fg)]">
        <input
          type="checkbox"
          className="size-4 accent-[var(--typren-primary)]"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }
  if (control === "number") {
    return (
      <div>
        <Label>{label}</Label>
        <Input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
      </div>
    );
  }
  if (control === "textarea" || control === "richtext") {
    return (
      <div>
        <Label>
          {label}
          {control === "richtext" && (
            <span className="ml-1 font-normal text-[var(--typren-muted-fg)]">(**bold** supported)</span>
          )}
        </Label>
        <Textarea
          className="min-h-20"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  if (control === "yaml") {
    return <YamlField label={label} value={value} onCommit={onChange} />;
  }
  if (control === "image" || control === "media") {
    // An image prop is either a bare string or a `{src, alt}` object (the
    // shapes the scaffold's field-schema template uses) — never a bare
    // top-level array. Arrays of `{src,alt}` are handled by "slot", not here.
    const isSrcAlt = value !== null && typeof value === "object" && !Array.isArray(value) && "src" in (value as object);
    if (isSrcAlt) {
      const obj = value as { src?: unknown; alt?: unknown };
      return (
        <div className="space-y-2">
          <Label>{label}</Label>
          <ImagePickerField
            value={typeof obj.src === "string" ? obj.src : ""}
            onChange={(src) => onChange({ ...obj, src })}
            media={media}
          />
          <Input
            placeholder="Alt text"
            value={typeof obj.alt === "string" ? obj.alt : ""}
            onChange={(e) => onChange({ ...obj, alt: e.target.value })}
          />
        </div>
      );
    }
    return (
      <div>
        <Label>{label}</Label>
        <ImagePickerField value={typeof value === "string" ? value : ""} onChange={onChange} media={media} />
      </div>
    );
  }
  if (control === "icon") {
    return (
      <div>
        <Label>{label}</Label>
        <IconPickerField value={typeof value === "string" ? value : ""} onChange={onChange} icons={icons} />
      </div>
    );
  }
  if (control === "link") {
    const obj = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as {
      label?: unknown;
      href?: unknown;
      external?: unknown;
    };
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Input
          placeholder="Link text"
          value={typeof obj.label === "string" ? obj.label : ""}
          onChange={(e) => onChange({ ...obj, label: e.target.value })}
        />
        <Input
          placeholder="https://…"
          value={typeof obj.href === "string" ? obj.href : ""}
          onChange={(e) => onChange({ ...obj, href: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-[var(--typren-fg)]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--typren-primary)]"
            checked={obj.external === true}
            onChange={(e) => onChange({ ...obj, external: e.target.checked })}
          />
          Opens in a new tab
        </label>
      </div>
    );
  }
  if (control === "slot") {
    return (
      <SlotField
        label={label}
        value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
        of={def?.of ?? {}}
        itemLabel={def?.itemLabel}
        media={media}
        icons={icons}
        onCommit={onChange}
      />
    );
  }
  // "text"
  return (
    <div>
      <Label>{label}</Label>
      <Input value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Existing-then-schema-declared key order, shared by the top-level slice
 *  props and a slot item's own fields — so authors can discover/add optional
 *  fields (enums, icons, …) not yet set on this particular object. */
function fieldKeysOf(present: Record<string, unknown>, schema: SliceSchema | undefined): string[] {
  return [...Object.keys(present), ...Object.keys(schema ?? {}).filter((k) => !(k in present))];
}

/**
 * One row of a "slot" field: add / remove / move-up / move-down, plus the
 * item's own fields rendered inline via `FieldRow`. Reorder is buttons (not
 * drag), so it's keyboard-operable for free. Each item gets a client-side-only
 * id purely so React has a stable `key` across reorders — content edits never
 * touch it, only add/remove/move do, so typing in a row never remounts it.
 */
function SlotField({
  label,
  value,
  of,
  itemLabel,
  media,
  icons,
  onCommit,
}: Readonly<
  {
    label: string;
    value: Record<string, unknown>[];
    of: SliceSchema;
    itemLabel?: string;
    onCommit: (next: Record<string, unknown>[]) => void;
  } & FieldCapabilities
>) {
  const [ids, setIds] = useState<string[]>(() => value.map(() => crypto.randomUUID()));
  // Resync if `value`'s length changed from outside our own add/remove/move
  // handlers below (e.g. the whole-block YAML editor rewrote the array while
  // this field stayed mounted). ponytail: full resync, drops row-identity
  // continuity on this rare path — still correct, just not animation-smooth.
  if (ids.length !== value.length) {
    setIds(value.map(() => crypto.randomUUID()));
  }

  const setItem = (i: number, next: Record<string, unknown>) =>
    onCommit(value.map((item, j) => (j === i ? next : item)));

  const addRow = () => {
    setIds([...ids, crypto.randomUUID()]);
    onCommit([...value, {}]);
  };

  const removeRow = (i: number) => {
    if (Object.keys(value[i]).length > 0 && !window.confirm("Remove this item? It has content.")) return;
    setIds(ids.filter((_, j) => j !== i));
    onCommit(value.filter((_, j) => j !== i));
  };

  const moveRow = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const nextIds = [...ids];
    [nextIds[i], nextIds[j]] = [nextIds[j], nextIds[i]];
    setIds(nextIds);
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onCommit(next);
  };

  return (
    <div>
      <Label>{label}</Label>
      <div className="space-y-3">
        {value.map((item, i) => {
          const titleValue = itemLabel ? item[itemLabel] : undefined;
          const title = typeof titleValue === "string" && titleValue ? titleValue : `Item ${i + 1}`;
          return (
            <div key={ids[i]} className="space-y-3 rounded-md border border-[var(--typren-border)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-[var(--typren-fg)]">{title}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${title} up`}
                    disabled={i === 0}
                    onClick={() => moveRow(i, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${title} down`}
                    disabled={i === value.length - 1}
                    onClick={() => moveRow(i, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    aria-label={`Remove ${title}`}
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {fieldKeysOf(item, of).map((k) => (
                  <FieldRow
                    key={k}
                    fieldKey={k}
                    def={of[k]}
                    value={item[k]}
                    onChange={(v) => setItem(i, { ...item, [k]: v })}
                    onUnset={() => {
                      const next = { ...item };
                      delete next[k];
                      setItem(i, next);
                    }}
                    media={media}
                    icons={icons}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addRow}>
        <Plus /> Add item
      </Button>
    </div>
  );
}

/**
 * Generic property editor for a slice. Each prop renders as a control chosen by
 * the optional `schema` (dropdowns for enum props) or auto-detected from the
 * value. Schema-declared props that aren't set yet are surfaced too, so authors
 * can discover and pick them. A whole-block YAML escape hatch covers anything
 * the auto-form can't express.
 */
export function FieldForm({
  slice,
  schema,
  onChange,
  media,
  icons,
}: Readonly<{
  slice: Slice;
  schema?: SliceSchema;
  onChange: (next: Slice) => void;
  /** Wires the "image"/"media" control's "Browse library" button. Absent →
   *  those fields degrade to a plain text input (no media library configured). */
  media?: FieldFormMedia;
  /** Wires the "icon" control's searchable picker. Absent → icon fields
   *  degrade to a plain text input (no icon library configured). */
  icons?: FieldFormIcons;
}>) {
  const [raw, setRaw] = useState(false);
  const set = (key: string, v: unknown) => onChange({ ...slice, [key]: v });
  const unset = (key: string) => {
    const next = { ...slice };
    delete next[key];
    onChange(next as Slice);
  };

  if (raw) {
    const { slice: name, ...rest } = slice;
    return (
      <div className="space-y-3">
        <BlockHeader name={name} raw={raw} setRaw={setRaw} />
        <YamlField
          label="Entire block"
          value={rest}
          onCommit={(v) =>
            onChange({ slice: name, ...(v && typeof v === "object" ? (v as object) : {}) })
          }
        />
      </div>
    );
  }

  // Existing props first (source order), then any schema-declared props not yet
  // present — so authors can add optional enums like `align`/`tone`.
  const keys = fieldKeysOf(
    Object.fromEntries(Object.entries(slice).filter(([k]) => k !== "slice")),
    schema
  );

  return (
    <div className="space-y-3">
      <BlockHeader name={slice.slice} raw={raw} setRaw={setRaw} />
      {keys.length === 0 && (
        <p className="text-sm text-[var(--typren-muted-fg)]">No fields. Use “Edit as YAML” to add some.</p>
      )}
      {keys.map((key) => (
        <FieldRow
          key={key}
          fieldKey={key}
          def={schema?.[key]}
          value={slice[key]}
          onChange={(v) => set(key, v)}
          onUnset={() => unset(key)}
          media={media}
          icons={icons}
        />
      ))}
    </div>
  );
}

function BlockHeader({
  name,
  raw,
  setRaw,
}: Readonly<{ name: string; raw: boolean; setRaw: (v: boolean) => void }>) {
  return (
    <div className="flex items-center justify-between">
      <span className="rounded bg-[var(--typren-muted)] px-2 py-0.5 font-mono text-xs text-[var(--typren-fg)]">
        {name}
      </span>
      <Button variant="ghost" size="sm" onClick={() => setRaw(!raw)}>
        {raw ? "Edit fields" : "Edit as YAML"}
      </Button>
    </div>
  );
}
