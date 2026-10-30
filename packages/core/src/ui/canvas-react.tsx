"use client";

import { Component, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import type { RendererAdapter } from "./canvas";

type Props = Record<string, unknown>;
type Slot = { id: number; el: HTMLElement; component: ComponentType<Props>; props: Props };

/** Isolates one section: a throw renders nothing in its place and tells the
 *  canvas (`typren:error` from its element); new props try it again. A
 *  class only because React has no other error boundary. */
class SectionBoundary extends Component<{ el: HTMLElement; props: Props; children: ReactNode }, { failed: boolean; at: Props }> {
  state = { failed: false, at: this.props.props };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(p: { props: Props }, s: { at: Props }) {
    return p.props === s.at ? null : { failed: false, at: p.props };
  }
  componentDidCatch() {
    this.props.el.dispatchEvent(new CustomEvent("typren:error", { bubbles: true }));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const NONE: Slot[] = [];

/**
 * The page canvas's React renderer. It creates no root per section, which
 * would cut sections off from the root layout's providers: each `mount`
 * adds a slot that the canvas's own React tree (its `Outlet`) fills with a
 * portal, so context reaches every section. A slot keeps its portal while
 * the canvas moves its element, so a reorder keeps the mounted instance.
 *
 * Changes made while handling one studio message commit together, in one
 * synchronous render a microtask later, so the canvas's `rendered` timing
 * sees them painted on the next frame.
 */
export function createReactRenderer(): RendererAdapter<ComponentType<Props>> {
  let slots = NONE;
  let next = 0;
  let queued = false;
  const listeners = new Set<() => void>();
  const changed = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      flushSync(() => listeners.forEach((l) => l()));
    });
  };
  const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

  function Outlet() {
    const list = useSyncExternalStore(
      subscribe,
      () => slots,
      () => NONE,
    );
    return list.map(({ id, el, component: Section, props }) =>
      createPortal(
        <SectionBoundary el={el} props={props}>
          <Section {...props} />
        </SectionBoundary>,
        el,
        String(id),
      ),
    );
  }

  return {
    name: "react",
    Outlet,
    mount(el, component, props) {
      const id = next++;
      slots = [...slots, { id, el, component, props }];
      changed();
      return {
        update(p) {
          slots = slots.map((s) => (s.id === id ? { ...s, props: p } : s));
          changed();
        },
        unmount() {
          slots = slots.filter((s) => s.id !== id);
          changed();
        },
      };
    },
  };
}
