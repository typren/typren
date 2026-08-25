/**
 * Rendered inside the preview route (vanilla, runs in the iframe's own
 * document, never in the editor's shadow tree; spec fact #4). Bridges the
 * preview iframe and the editor:
 *  - click a block (an element wrapped with `data-typren-index`) to select it
 *  - double-click a text element to edit it inline; on blur the new text is
 *    posted back to the editor, which maps it to the matching slice field
 *  - applies an independent light/dark theme + scroll-to on request
 */

const STYLE_ID = "typren-preview-bridge-style";

const STYLE = `
  [data-typren-index]{cursor:pointer}
  [data-typren-index]:hover{outline:2px dashed color-mix(in oklab, var(--typren-primary, #6366f1) 60%, transparent);outline-offset:-2px}
  [data-typren-selected]{outline:2px solid var(--typren-primary, #6366f1) !important;outline-offset:-2px}
  [contenteditable="true"]{outline:2px solid var(--typren-primary, #6366f1);outline-offset:2px;cursor:text}
`;

/**
 * Attach the preview bridge listeners + inject its stylesheet into
 * `document.head` (once). Returns a cleanup function that removes the
 * listeners (the injected `<style>` is left in place: idempotent, harmless).
 *
 * `allowedOrigin` is the one origin this frame will post to and accept
 * messages from. Omit it and the bridge defaults to `window.location.origin`
 * (byte-identical to the old same-origin-only behavior, for local/self-host
 * setups embedding their own dashboard). A hosted dashboard framing a
 * customer's site is cross-origin by definition, so it must pass its own
 * origin explicitly here (learned from the site record) — this is never
 * `"*"`; the channel always compares against one explicit value.
 */
export function initPreviewBridge(allowedOrigin?: string): () => void {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const origin = allowedOrigin ?? window.location.origin;
  const wrapperIndex = (node: EventTarget | null): number | null => {
    const el = (node as Element | null)?.closest?.("[data-typren-index]");
    return el ? Number(el.getAttribute("data-typren-index")) : null;
  };
  const mark = (index: number) => {
    document.querySelectorAll("[data-typren-index]").forEach((el) => {
      el.toggleAttribute("data-typren-selected", Number(el.getAttribute("data-typren-index")) === index);
    });
  };

  const onClick = (e: MouseEvent) => {
    const t = e.target as Element;
    if (t?.closest?.('[contenteditable="true"]')) return; // let caret placement work
    const index = wrapperIndex(t);
    e.preventDefault(); // don't follow links inside the editor canvas
    e.stopPropagation();
    // `index: null` = clicked the page background rather than a block. The
    // editor treats that as "select the page itself" and swaps the Properties
    // panel to the page's own frontmatter, so it has to be posted, not dropped.
    window.parent?.postMessage({ __typren: true, type: "select", index }, origin);
    mark(index ?? -1); // -1 matches no block, so every outline clears
  };

  const onDblClick = (e: MouseEvent) => {
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
        window.parent?.postMessage(
          { __typren: true, type: "edit", index: wrapperIndex(el), before, after },
          origin
        );
      }
    };
    el.addEventListener("blur", onBlur);
  };

  const onMessage = (e: MessageEvent) => {
    // Same check the editor side applies. This frame renders draft content and
    // can be embedded, so it should only take instructions from its own origin.
    // The channel was guarded on one side only.
    if (e.origin !== origin) return;
    const d = e.data;
    if (!d || d.__typren !== true) return;
    if (d.type === "theme") {
      document.documentElement.classList.toggle("dark", d.theme === "dark");
    }
    if (d.type === "select" && d.index === null) {
      mark(-1); // editor deselected (page properties), drop the outline
      return;
    }
    if ((d.type === "select" || d.type === "scrollTo") && typeof d.index === "number") {
      mark(d.index);
      // `reveal: false` re-marks without moving the viewport, used when the
      // editor reloads this frame to show a save and restores the scroll itself.
      if (d.reveal === false) return;
      document
        .querySelector(`[data-typren-index="${d.index}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDblClick, true);
  window.addEventListener("message", onMessage);

  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDblClick, true);
    window.removeEventListener("message", onMessage);
  };
}
