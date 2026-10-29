/**
 * Rendered inside the preview route (vanilla, runs in the iframe's own
 * document, never in the editor's shadow tree; spec fact #4). Bridges the
 * preview iframe and the editor:
 *  - click a block (an element wrapped with `data-typren-index`) to select it
 *  - double-click a text element to edit it inline; on blur the new text is
 *    posted back to the editor, which maps it to the matching slice field
 *  - applies an independent light/dark theme + scroll-to on request
 *  - draws the editor's hover and selection outlines in this document, in a
 *    shadow root laid over the page, so they scroll with it natively; the
 *    editor says which blocks (`outline`), in its own colour
 *  - posts every block's rect on a layout change, the document's scroll on
 *    each frame it scrolls, and the hovered block, so the editor can place
 *    its interactive controls over this frame
 *  - posts its path on load and on every navigation, so a browsing editor
 *    can follow it; once the editor answers `browse`, clicks and
 *    double-clicks are left to the site, so its links work, until `edit`
 *    makes the page an edit canvas again
 *  - answers `computedStyle` with the site's effective values for the Style
 *    screen's tokens
 */

import { CUSTOM_PROPERTY } from "../style";

/** True for a serialized http(s) origin such as "http://127.0.0.1:4400". */
export function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
}

/** A 1px canvas to flatten colours with, or null where there is none (jsdom). */
function canvas(): CanvasRenderingContext2D | null {
  try {
    return document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  } catch {
    return null;
  }
}

/** A computed colour as rgb()/rgba(). The probe has already settled
 *  `light-dark()` for the frame's colour scheme and resolved `var()`, but
 *  engines keep `color-mix()` as oklab() and oklch() as written; painting it
 *  reads back sRGB bytes. ponytail: wide-gamut colours clip to sRGB, which
 *  is what the editor's contrast maths works in anyway. */
function srgb(ctx: CanvasRenderingContext2D, color: string): string {
  if (/^rgba?\(/.test(color)) return color;
  ctx.clearRect(0, 0, 1, 1);
  // The engine wrote `color` itself, so it parses; the reset is belt and braces.
  ctx.fillStyle = "transparent";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round((a! / 255) * 1000) / 1000})`;
}

const STYLE_ID = "typren-preview-bridge-style";

const STYLE = `
  [data-typren-index]{cursor:pointer}
  [contenteditable="true"]{outline:2px solid var(--typren-primary, #6366f1);outline-offset:2px;cursor:text}
`;

const SCROLLBAR_STYLE_ID = "typren-preview-bridge-scrollbar";

// The studio's ScrollArea bar, redrawn over the page: the native bar is
// hidden (so it takes no gutter) and a 6px thumb, inside a 14px grab area
// that widens it on hover, floats on the right edge,
// shown while scrolling or hovered, in muted-foreground at 40%. The first
// colour is the fallback for a site with no `--muted-foreground` or an engine
// without `color-mix`.
const SCROLLBAR_STYLE = `
  html{scrollbar-width:none}
  html::-webkit-scrollbar{display:none}
  #typren-preview-scroll-thumb{position:fixed;top:0;right:0;width:14px;z-index:2147483647;opacity:0;transition:opacity .3s;touch-action:none;cursor:default}
  #typren-preview-scroll-thumb::after{content:"";position:absolute;top:0;bottom:0;right:0;width:6px;border-radius:9999px;background:#8886;background:color-mix(in srgb,var(--muted-foreground,#888) 40%,transparent);transition:width .15s,background-color .15s}
  #typren-preview-scroll-thumb[data-shown]{opacity:1;transition-duration:75ms}
  #typren-preview-scroll-thumb:hover,#typren-preview-scroll-thumb[data-dragging]{opacity:1}
  #typren-preview-scroll-thumb:hover::after,#typren-preview-scroll-thumb[data-dragging]::after{width:10px;background:color-mix(in srgb,var(--muted-foreground,#888) 70%,transparent)}
  @media (prefers-reduced-motion:reduce){#typren-preview-scroll-thumb,#typren-preview-scroll-thumb::after{transition:none}}
`;

/** Floats the overlay thumb over the document and keeps it in step with the
 *  page's scroll; dragging it scrolls. Returns its teardown. */
function overlayScrollbar(): () => void {
  const thumb = document.createElement("div");
  thumb.id = "typren-preview-scroll-thumb";
  thumb.setAttribute("aria-hidden", "true");
  document.body.appendChild(thumb);
  const root = document.scrollingElement ?? document.documentElement;
  let hide: ReturnType<typeof setTimeout> | undefined;
  const place = () => {
    const view = window.innerHeight;
    const total = root.scrollHeight;
    thumb.style.display = total > view + 1 ? "" : "none";
    const height = Math.max(24, (view * view) / total);
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${(root.scrollTop / (total - view || 1)) * (view - height)}px)`;
  };
  const onScroll = () => {
    place();
    thumb.setAttribute("data-shown", "");
    clearTimeout(hide);
    hide = setTimeout(() => thumb.removeAttribute("data-shown"), 700);
  };
  let grab: { y: number; top: number } | null = null;
  const onDown = (e: PointerEvent) => {
    grab = { y: e.clientY, top: root.scrollTop };
    thumb.setPointerCapture?.(e.pointerId);
    thumb.setAttribute("data-dragging", "");
  };
  const onMove = (e: PointerEvent) => {
    if (!grab) return;
    const view = window.innerHeight;
    const height = thumb.offsetHeight || view;
    root.scrollTop = grab.top + ((e.clientY - grab.y) * (root.scrollHeight - view)) / Math.max(1, view - height);
  };
  const onUp = () => {
    grab = null;
    thumb.removeAttribute("data-dragging");
  };
  thumb.addEventListener("pointerdown", onDown);
  thumb.addEventListener("pointermove", onMove);
  thumb.addEventListener("pointerup", onUp);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", place);
  const grow = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
  grow?.observe(document.body);
  place();
  return () => {
    clearTimeout(hide);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", place);
    grow?.disconnect();
    thumb.remove();
  };
}

/** A block's box in document coordinates. */
type Box = { top: number; left: number; width: number; height: number };

/** The editor's outlines, drawn in page coordinates on a layer over the
 *  document, so they scroll with the blocks on the compositor, frame for
 *  frame. A shadow root keeps the site's CSS off them and theirs off
 *  the site; nothing takes the pointer. Self-contained: the bridge feeds it
 *  boxes and the editor's choice, it touches nothing else. */
function pageOutlines() {
  const host = document.createElement("div");
  host.setAttribute("data-typren-outlines", "");
  host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    "div{position:absolute;box-sizing:border-box;pointer-events:none;box-shadow:inset 0 0 0 2px var(--typren-outline,#f74c25)}";
  root.appendChild(style);
  const active = document.createElement("div");
  const selected = document.createElement("div");
  root.append(selected, active);
  document.documentElement.appendChild(host);
  let shown: { active: number | null; selected: number | null } = { active: null, selected: null };
  const place = (el: HTMLElement, box: Box | undefined) => {
    el.hidden = !box;
    if (box) Object.assign(el.style, { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` });
  };
  return {
    /** Which blocks to outline, and in what colour; null for none. */
    set(next: { active: number | null; selected: number | null }, color?: string) {
      shown = next;
      // A custom property can carry no rule, whatever string the editor sends.
      if (color) host.style.setProperty("--typren-outline", color);
    },
    draw(boxes: Map<number, Box>, visible: boolean) {
      host.hidden = !visible;
      place(active, shown.active === null ? undefined : boxes.get(shown.active));
      place(selected, shown.selected === null || shown.selected === shown.active ? undefined : boxes.get(shown.selected));
    },
    remove: () => host.remove(),
  };
}

const index = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);

/**
 * Attach the preview bridge listeners + inject its stylesheet into
 * `document.head` (once). Returns a cleanup function that removes the
 * listeners (the base `<style>` is left in place: idempotent, harmless; the scrollbar one is removed).
 *
 * `allowedOrigin` is the one origin this frame will post to and accept
 * messages from. Omit it and the bridge defaults to `window.location.origin`
 * (byte-identical to the old same-origin-only behavior, for local/self-host
 * setups embedding their own dashboard). A hosted dashboard framing a
 * customer's site is cross-origin by definition, so it must pass its own
 * origin explicitly here (learned from the site record), this is never
 * `"*"`; the channel always compares against one explicit value.
 *
 * Fails closed: an `allowedOrigin` that is not a bare http(s) origin (`"*"`,
 * `"null"`, an empty env var, a URL with a path) leaves the bridge inert,
 * with no listeners attached, rather than guessing what was meant.
 *
 * `nonce` is the studio's session nonce (the page canvas reads it from its
 * URL fragment): with one, every post carries it and a message without it
 * is ignored, so a page the frame navigates to cannot speak for it.
 */
export function initPreviewBridge(allowedOrigin?: string, nonce?: string): () => void {
  if (allowedOrigin !== undefined && !isOrigin(allowedOrigin)) {
    console.warn(`[typren] preview bridge disabled: "${allowedOrigin}" is not an http(s) origin`);
    return () => {};
  }
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  // Unlike the base stylesheet, the scrollbar restyle exists only while the
  // studio is connected: the live site keeps its own scrollbar.
  const scrollbarStyle = document.createElement("style");
  scrollbarStyle.id = SCROLLBAR_STYLE_ID;
  scrollbarStyle.textContent = SCROLLBAR_STYLE;
  document.head.appendChild(scrollbarStyle);
  const removeThumb = overlayScrollbar();

  const origin = allowedOrigin ?? window.location.origin;
  const wrapperIndex = (node: EventTarget | null): number | null => {
    const el = (node as Element | null)?.closest?.("[data-typren-index]");
    return el ? Number(el.getAttribute("data-typren-index")) : null;
  };
  const post = (message: Record<string, unknown>) =>
    window.parent?.postMessage({ __typren: true, ...message, ...(nonce && { nonce }) }, origin);

  const outlines = pageOutlines();
  // Until the editor says it is only browsing, this frame is an edit canvas.
  let browsing = false;
  // Document-coordinate boxes, kept for redrawing the outlines.
  let boxes = new Map<number, Box>();

  // Layout and DOM changes can fire many times per frame; one rAF coalesces
  // them into a single `rects` post. Viewport rects plus the scroll they were
  // measured at, so the editor can place them in page coordinates too.
  let frame = 0;
  const postRects = () => {
    frame = 0;
    const { scrollX, scrollY } = window;
    const rects = Array.from(document.querySelectorAll("[data-typren-index]"), (el) => {
      const r = el.getBoundingClientRect();
      return { index: Number(el.getAttribute("data-typren-index")), top: r.top, left: r.left, width: r.width, height: r.height };
    });
    boxes = new Map(rects.map((r) => [r.index, { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height }]));
    outlines.draw(boxes, !browsing);
    post({ type: "rects", rects, scrollX, scrollY });
  };
  const queueRects = () => {
    frame ||= requestAnimationFrame(postRects);
  };
  // The document scrolling moves no block within it: one `scroll` post per
  // frame is all the editor needs to keep its controls in step. A scroll
  // inside the page (a carousel, a scrolling panel) can move blocks, so it
  // measures again.
  let scrollFrame = 0;
  const postScroll = () => {
    scrollFrame = 0;
    post({ type: "scroll", x: window.scrollX, y: window.scrollY });
  };
  const onScroll = (e: Event) => {
    const t = e.target;
    if (!(t instanceof Element) || t === document.documentElement || t === document.scrollingElement)
      scrollFrame ||= requestAnimationFrame(postScroll);
    else queueRects();
  };

  let path: string | null = null;
  const postLocation = () => {
    if (window.location.pathname === path) return;
    path = window.location.pathname;
    post({ type: "location", path });
  };

  let hovered: number | null = null;
  // Leaving this document posts nothing: the pointer is usually heading for
  // the editor's overlay controls over the same block, so the editor decides
  // when hover ends.
  const onMouseOver = (e: MouseEvent) => {
    const index = wrapperIndex(e.target);
    if (index === hovered) return;
    hovered = index;
    post({ type: "hover", index });
  };

  const onClick = (e: MouseEvent) => {
    if (browsing) return;
    const t = e.target as Element;
    if (t?.closest?.('[contenteditable="true"]')) return; // let caret placement work
    const index = wrapperIndex(t);
    e.preventDefault(); // don't follow links inside the editor canvas
    e.stopPropagation();
    // `index: null` = clicked the page background rather than a block. The
    // editor treats that as "select the page itself" and swaps the Properties
    // panel to the page's own frontmatter, so it has to be posted, not dropped.
    post({ type: "select", index });
  };

  const onDblClick = (e: MouseEvent) => {
    if (browsing) return;
    const el = e.target as HTMLElement;
    // Only edit leaf text elements inside a block.
    if (!el || el.childElementCount > 0 || wrapperIndex(el) === null) return;
    el.setAttribute("contenteditable", "true");
    el.dataset.typrenBefore = el.textContent ?? "";
    el.focus();
    const onBlur = () => {
      el.removeAttribute("contenteditable");
      const before = el.dataset.typrenBefore ?? "";
      const after = el.textContent ?? "";
      delete el.dataset.typrenBefore;
      el.removeEventListener("blur", onBlur);
      if (after !== before) {
        post({ type: "edit", index: wrapperIndex(el), before, after });
      }
    };
    el.addEventListener("blur", onBlur);
  };

  const appliedStyle = new Set<string>();
  // The Style screen's question: what the site's own CSS makes of these
  // custom properties (the live draft lifted off first), with `colors`
  // resolved to rgb() through a probe, plus the fonts its body and headings
  // end up with. Read-only, and answered only to the allowed origin.
  const postComputed = (names: unknown[], colors: unknown[]) => {
    const valid = (n: unknown): n is string => typeof n === "string" && CUSTOM_PROPERTY.test(n);
    const root = document.documentElement.style;
    const draft = [...appliedStyle].map((k) => [k, root.getPropertyValue(k)] as const);
    for (const [k] of draft) root.removeProperty(k);
    const css = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    probe.hidden = true;
    document.body.appendChild(probe);
    const vars: Record<string, string> = {};
    let ctx: CanvasRenderingContext2D | null | undefined;
    for (const n of names.slice(0, 128).filter(valid)) {
      const raw = css.getPropertyValue(n).trim();
      if (!raw) continue;
      probe.style.color = "";
      probe.style.color = `var(${n})`;
      const color = colors.includes(n) && probe.style.color ? getComputedStyle(probe).color : "";
      // An engine that leaves var() unresolved gets the raw value instead.
      if (!color || color.includes("var(")) {
        vars[n] = raw;
        continue;
      }
      ctx ??= canvas();
      vars[n] = ctx ? srgb(ctx, color) : color;
    }
    probe.remove();
    const read = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return undefined;
      const c = getComputedStyle(el);
      return { color: c.color, background: c.backgroundColor, fontFamily: c.fontFamily, fontSize: c.fontSize, lineHeight: c.lineHeight };
    };
    const elements = { html: read("html"), body: read("body"), h1: read("h1"), h2: read("h2") };
    for (const [k, v] of draft) root.setProperty(k, v);
    post({ type: "computedStyle", vars, elements });
  };
  const onMessage = (e: MessageEvent) => {
    // This frame renders draft content and can be embedded, so it only takes
    // instructions from the one allowed origin. The editor side cannot do the
    // same (it sandboxes this frame into an opaque origin), so it checks
    // `event.source` instead.
    if (e.origin !== origin) return;
    const d = e.data;
    if (!d || d.__typren !== true || (nonce && d.nonce !== nonce)) return;
    if (d.type === "browse") {
      browsing = true;
      outlines.draw(boxes, false);
    }
    // The editor keeps one frame across browse and edit mode: back to an
    // edit canvas, with fresh geometry for its overlay.
    if (d.type === "edit") {
      browsing = false;
      queueRects();
    }
    if (d.type === "outline") {
      outlines.set(
        { active: index(d.active), selected: index(d.selected) },
        typeof d.color === "string" && d.color.length <= 100 ? d.color : undefined,
      );
      outlines.draw(boxes, !browsing);
    }
    if (d.type === "theme") {
      document.documentElement.classList.toggle("dark", d.theme === "dark");
    }
    if (d.type === "style" && d.vars && typeof d.vars === "object") {
      // Live Style screen: the editor's draft tokens and the site's own names
      // they map to (see styleVars), applied as custom properties. Only plain
      // custom property names, and setProperty cannot inject rules.
      const root = document.documentElement.style;
      for (const k of appliedStyle) if (!(k in d.vars)) root.removeProperty(k);
      appliedStyle.clear();
      for (const [k, v] of Object.entries(d.vars)) {
        if (!CUSTOM_PROPERTY.test(k) || typeof v !== "string") continue;
        root.setProperty(k, v);
        appliedStyle.add(k);
      }
    }
    if (d.type === "computedStyle" && Array.isArray(d.names)) postComputed(d.names, Array.isArray(d.colors) ? d.colors : []);
    if ((d.type === "select" || d.type === "scrollTo") && typeof d.index === "number") {
      // `reveal: false` leaves the viewport alone, used when the editor
      // reloads this frame to show a save and restores the scroll itself.
      if (d.reveal === false) return;
      document
        .querySelector(`[data-typren-index="${d.index}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDblClick, true);
  window.addEventListener("message", onMessage);
  document.addEventListener("mouseover", onMouseOver);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // The root's box changes with the frame width (device toggle) and with
  // content height; jsdom and very old engines have no ResizeObserver.
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queueRects);
  resize?.observe(document.documentElement);
  // Attributes are left out: they rarely move a block, and the inline editor
  // toggles them on every double-click.
  const mutations = new MutationObserver(queueRects);
  mutations.observe(document.body, { childList: true, subtree: true, characterData: true });
  queueRects();
  // ponytail: polls, since client-side routers move with history.pushState,
  // which fires no event. The Navigation API's `navigatesuccess` replaces
  // this once every engine ships it.
  const poll = setInterval(postLocation, 250);
  window.addEventListener("popstate", postLocation);
  postLocation();

  return () => {
    scrollbarStyle.remove();
    removeThumb();
    clearInterval(poll);
    window.removeEventListener("popstate", postLocation);
    cancelAnimationFrame(frame);
    cancelAnimationFrame(scrollFrame);
    outlines.remove();
    resize?.disconnect();
    mutations.disconnect();
    document.removeEventListener("mouseover", onMouseOver);
    window.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDblClick, true);
    window.removeEventListener("message", onMessage);
  };
}
