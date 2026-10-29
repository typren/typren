"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor, Palette, Shapes, Type } from "lucide-react";
import { STYLE_MAP_DEFAULT, STYLE_TOKENS, mappedName, styleVars } from "@typren/core";
import type { StyleMap, StyleTokenGroup } from "@typren/core";
import type { SettingsDraft } from "./settings-panel";
import { DevicePreview, fromFrame, postToFrame, type Device } from "./device-preview";
import { Button } from "./primitives/button";
import { EmptyState } from "./primitives/empty";
import { SelectionList, rowClass } from "./primitives/selection";
import { ColorsScreen } from "./style-colors";
import { withToken } from "./style-parts";
import { ShapeScreen } from "./style-shape";
import { TypeScreen } from "./style-type";
import { PanelHeader } from "./primitives/panel-header";

export type StyleScreenId = "colors" | "type" | "shape";

export const STYLE_SCREENS: { id: StyleScreenId; label: string; group: StyleTokenGroup; Icon: typeof Palette }[] = [
  { id: "colors", label: "Colors", group: "colors", Icon: Palette },
  { id: "type", label: "Type", group: "typography", Icon: Type },
  { id: "shape", label: "Shape", group: "shape", Icon: Shapes },
];

/** Level 1 under Website → Style: one row per Style screen. */
export function StyleLevel({ current, onOpen }: Readonly<{ current: StyleScreenId; onOpen: (id: StyleScreenId) => void }>) {
  return (
    <SelectionList>
      <PanelHeader title="Style" />
      <ul className="space-y-1 px-3 pb-4">
        {STYLE_SCREENS.map(({ id, label, Icon }) => (
          <li key={id}>
            <button type="button" aria-current={id === current ? "page" : undefined} onClick={() => onOpen(id)} className={rowClass(id === current)}>
              <Icon className="size-4 shrink-0 text-[var(--typren-muted-fg)]" aria-hidden />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </SelectionList>
  );
}

type Computed = { color?: string; background?: string; fontFamily?: string; fontSize?: string; lineHeight?: string };
/** The preview bridge's `computedStyle` answer. */
export type ComputedStyleReply = { vars?: Record<string, string>; elements?: Record<string, Computed | undefined> };

const px = (v?: string) => (v?.endsWith("px") ? Number.parseFloat(v) : Number.NaN);
const ratio = (a?: string, b?: string) => {
  const r = px(a) / px(b);
  return Number.isFinite(r) && r > 0 ? String(Math.round(r * 1000) / 1000) : undefined;
};
const opaque = (c?: string) => (c && !/^(transparent|rgba\(.*,\s*0\))$/.test(c) ? c : undefined);

/** The names to ask the preview for: every token's mapped name. */
export const readNames = (map: StyleMap) => STYLE_TOKENS.map((t) => mappedName(t.name, map));

/**
 * The site's own value for each token, from the bridge's answer: the computed
 * value of the token's mapped name, and for type tokens nothing maps, what
 * the site's body and headings compute to. The type scale is left out: a
 * site's h1 and h2 rarely sit one modular step apart.
 */
export function siteStyle(reply: ComputedStyleReply, map: StyleMap): Record<string, string> {
  const vars = reply.vars ?? {};
  const { html, body, h1, h2 } = reply.elements ?? {};
  const heading = h1 ?? h2;
  const computed: Record<string, string | undefined> = {
    "--typren-bg": opaque(body?.background) ?? opaque(html?.background),
    "--typren-fg": body?.color,
    "--typren-font-body": body?.fontFamily,
    "--typren-font-heading": heading?.fontFamily,
    "--typren-font-size": body?.fontSize,
    "--typren-line-height": ratio(body?.lineHeight, body?.fontSize),
    "--typren-heading-line-height": ratio(heading?.lineHeight, heading?.fontSize),
  };
  const out: Record<string, string> = {};
  for (const t of STYLE_TOKENS) {
    const v = vars[mappedName(t.name, map)] || (t.group === "typography" ? computed[t.name] : undefined);
    if (v) out[t.name] = v;
  }
  return out;
}

/**
 * Style's view of the settings doc's draft (see `useSettingsDraft`): the
 * `--typren-*` tokens it holds, set through the same autosave, with the same
 * top-bar controls. Setting a token restyles the preview live; no write
 * reloads it.
 */
export function useStyleDraft({ draft, styleMap }: Readonly<{ draft: SettingsDraft; styleMap?: StyleMap }>) {
  const style = draft.rt.style ?? {};
  return {
    ready: draft.ready,
    style,
    set: (name: string, value: string) => draft.edit((rt) => ({ ...rt, style: withToken(rt.style ?? {}, name, value) })),
    map: styleMap ?? STYLE_MAP_DEFAULT,
    dirty: draft.dirty,
    actions: draft.actions,
    banner: draft.banner,
    dialog: draft.dialog,
  };
}

export type StyleDraft = ReturnType<typeof useStyleDraft>;

/**
 * Website → Style: one screen of the site's `--typren-*` tokens (Colors, Type
 * or Shape) over the draft the shell keeps (see `useStyleDraft`). The site's
 * preview stays mounted, hidden until "Preview site" shows it: it restyles
 * live with the draft, and it is where the site's own values come from, shown
 * for every token the draft leaves unset.
 */
export function StylePanel({
  screen = "colors",
  draft,
  previewSrc,
  device,
}: Readonly<{
  screen?: StyleScreenId;
  draft: StyleDraft;
  /** The page the draft tokens are shown on (the home page). */
  previewSrc: string;
  device: Device;
}>) {
  const [preview, setPreview] = useState(false);
  const [site, setSite] = useState<Record<string, string>>({});
  const frame = useRef<HTMLIFrameElement>(null);
  const { style, map } = draft;

  // Re-posted on every change and on every (re)load of the frame.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const post = () => postToFrame(el, { __typren: true, type: "style", vars: styleVars(style, map) });
    post();
    el.addEventListener("load", post);
    return () => el.removeEventListener("load", post);
  }, [style, map, previewSrc]);

  // The site's own values: asked on load and whenever the bridge announces
  // itself (its `location`), since a site may start it after load. The frame
  // is looked up per message, as the preview can mount after this effect.
  useEffect(() => {
    const colors = STYLE_TOKENS.filter((tok) => tok.kind === "color").map((tok) => mappedName(tok.name, map));
    const ask = () => postToFrame(frame.current, { __typren: true, type: "computedStyle", names: readNames(map), colors });
    const onMessage = (e: MessageEvent) => {
      // Identified by source and origin, as in PageEditor.
      if (!fromFrame(e, frame.current) || e.data?.__typren !== true) return;
      if (e.data.type === "location") ask();
      if (e.data.type === "computedStyle") setSite(siteStyle(e.data as ComputedStyleReply, map));
    };
    const el = frame.current;
    el?.addEventListener("load", ask);
    window.addEventListener("message", onMessage);
    return () => {
      el?.removeEventListener("load", ask);
      window.removeEventListener("message", onMessage);
    };
  }, [map, previewSrc]);

  if (!draft.ready) {
    return (
      <EmptyState icon={<Palette />} title="Style isn’t configured for this site." />
    );
  }

  const meta = STYLE_SCREENS.find((s) => s.id === screen)!;
  const Screen = { colors: ColorsScreen, type: TypeScreen, shape: ShapeScreen }[screen];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--typren-stroke-divider)] px-4 py-2">
        <span className="text-sm font-semibold">{meta.label}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={preview}
          className="ml-auto aria-pressed:bg-[var(--typren-fill-subtle-selected)] aria-pressed:text-[var(--typren-fg)]"
          onClick={() => setPreview((v) => !v)}
        >
          <Monitor /> Preview site
        </Button>
      </header>
      <Screen
        style={style}
        site={site}
        set={draft.set}
        preview={preview}
        stage={<DevicePreview src={previewSrc} device={device} reloadKey={0} iframeRef={frame} />}
      />
      {draft.dialog}
    </div>
  );
}
