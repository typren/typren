import { useEffect, useRef } from "react";

const SELECTOR = ".typren-grain, .typren-selected";

/**
 * Fluent-style reveal: the pointer's position, relative to each nearby
 * surface, as `--rx`/`--ry` on that surface, for the halo in
 * theme.css. One passive listener on the root and one rAF per frame. Rects
 * are cached and re-read only on scroll, resize and DOM change, never in the
 * move handler, and only surfaces within `radius` are written.
 *
 * ponytail: rects go stale while a surface is mid-transition (the rail slide)
 * until the next scroll or mutation, and the scan is linear in surfaces.
 * Fine for hundreds; a spatial index if a screen ever holds thousands.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !window.matchMedia?.("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    let items: { el: HTMLElement; r: DOMRect }[] = [];
    const lit = new Set<HTMLElement>();
    let at: { x: number; y: number } | null = null;
    let frame = 0;
    const radius = () => parseFloat(getComputedStyle(root).getPropertyValue("--typren-reveal-radius")) || 0;
    const clear = (el: HTMLElement) => {
      el.style.removeProperty("--rx");
      el.style.removeProperty("--ry");
    };
    const paint = () => {
      frame = 0;
      const reach = radius();
      for (const el of lit) clear(el);
      lit.clear();
      if (!at || !reach) return;
      for (const { el, r } of items) {
        const dx = Math.max(r.left - at.x, 0, at.x - r.right);
        const dy = Math.max(r.top - at.y, 0, at.y - r.bottom);
        if (dx * dx + dy * dy > reach * reach) continue;
        el.style.setProperty("--rx", `${at.x - r.left}px`);
        el.style.setProperty("--ry", `${at.y - r.top}px`);
        lit.add(el);
      }
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(paint);
    };
    const measure = () => {
      items = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR), (el) => ({ el, r: el.getBoundingClientRect() }));
      schedule();
    };
    let measureFrame = 0;
    const remeasure = () => {
      measureFrame ||= requestAnimationFrame(() => {
        measureFrame = 0;
        measure();
      });
    };
    const move = (e: PointerEvent) => {
      at = { x: e.clientX, y: e.clientY };
      schedule();
    };
    const leave = () => {
      at = null;
      schedule();
    };
    // Entering the preview iframe fires no pointerleave on the root (the frame
    // is inside it) and the frame's moves never reach this document.
    const out = (e: PointerEvent) => {
      const to = e.relatedTarget as Element | null;
      if (!to || to.tagName === "IFRAME" || !root.contains(to)) leave();
    };
    measure();
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointerout", out);
    root.addEventListener("scroll", remeasure, { capture: true, passive: true });
    addEventListener("resize", remeasure);
    const mo = new MutationObserver(remeasure);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("scroll", remeasure, { capture: true });
      removeEventListener("resize", remeasure);
      mo.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame);
      lit.forEach(clear);
    };
  }, []);
  return ref;
}
