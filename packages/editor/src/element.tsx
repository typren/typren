"use client";

import { createRoot, type Root } from "react-dom/client";
import { useEffect, useRef } from "react";
import { TyprenEditor, type TyprenEditorProps } from "./typren-editor";
import type { TyprenEditorHost } from "./types";

/** Same as `TyprenEditorHost`, except `topBarSlot` takes a raw DOM `Node`
 *  instead of a `ReactNode` — a non-React host (the whole point of this
 *  entry) can't produce JSX. `DomSlot` below projects it into the tree. */
export type TyprenShellHost = Omit<TyprenEditorHost, "topBarSlot"> & { topBarSlot?: Node };

/** Projects a host-supplied DOM node into the React tree without adopting it
 *  (no cloning, no serialization) — it's moved into a plain wrapper div and
 *  moved back out on cleanup. `display: contents` keeps the wrapper out of
 *  the host's layout. */
function DomSlot({ node }: Readonly<{ node: Node }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mount = ref.current;
    mount?.appendChild(node);
    return () => {
      if (mount?.contains(node)) mount.removeChild(node);
    };
  }, [node]);
  return <div ref={ref} className="contents" />;
}

type ShellProps = Omit<TyprenEditorProps, "host"> & { host?: TyprenShellHost };

/**
 * Wraps `TyprenEditor` as a custom element for hosts that aren't React
 * themselves (Astro islands, a plain `<script type="module">`, …) — same
 * React tree as this package's main export, mounted with `react-dom/client`.
 *
 * Renders into light DOM, no shadow root: the shell's classes reference the
 * `--typren-*` custom properties from `@typren/core`'s `theme.css`, which the
 * host page is expected to load globally, same as every other consumer.
 *
 * Mount by setting properties, not attributes — the data here is objects and
 * functions, which attributes can't carry:
 *
 *   const el = document.createElement("typren-shell");
 *   el.host = { actions, sliceNames, defaults, previewPath };
 *   el.pages = pages;
 *   el.onNavigate = (slug) => { ... };
 *   el.onReload = () => { ... };
 *   document.body.append(el);
 *
 * Properties may be set before or after the element is connected; each
 * setter re-renders once `host`, `pages`, `onNavigate` and `onReload` are all
 * present.
 */
export class TyprenShellElement extends HTMLElement {
  #root: Root | null = null;
  #props: Partial<ShellProps> = {};

  get host() {
    return this.#props.host;
  }
  set host(v: TyprenShellHost | undefined) {
    this.#props.host = v;
    this.#render();
  }

  get pages() {
    return this.#props.pages;
  }
  set pages(v: TyprenEditorProps["pages"] | undefined) {
    this.#props.pages = v;
    this.#render();
  }

  get slug() {
    return this.#props.slug;
  }
  set slug(v: TyprenEditorProps["slug"]) {
    this.#props.slug = v;
    this.#render();
  }

  get page() {
    return this.#props.page;
  }
  set page(v: TyprenEditorProps["page"]) {
    this.#props.page = v;
    this.#render();
  }

  get version() {
    return this.#props.version;
  }
  set version(v: TyprenEditorProps["version"]) {
    this.#props.version = v;
    this.#render();
  }

  get locale() {
    return this.#props.locale;
  }
  set locale(v: TyprenEditorProps["locale"]) {
    this.#props.locale = v;
    this.#render();
  }

  get layout() {
    return this.#props.layout;
  }
  set layout(v: TyprenEditorProps["layout"]) {
    this.#props.layout = v;
    this.#render();
  }

  get messages() {
    return this.#props.messages;
  }
  set messages(v: TyprenEditorProps["messages"]) {
    this.#props.messages = v;
    this.#render();
  }

  get onNavigate() {
    return this.#props.onNavigate;
  }
  set onNavigate(v: TyprenEditorProps["onNavigate"] | undefined) {
    this.#props.onNavigate = v;
    this.#render();
  }

  get onReload() {
    return this.#props.onReload;
  }
  set onReload(v: TyprenEditorProps["onReload"] | undefined) {
    this.#props.onReload = v;
    this.#render();
  }

  connectedCallback() {
    this.#root ??= createRoot(this);
    this.#render();
  }

  disconnectedCallback() {
    this.#root?.unmount();
    this.#root = null;
  }

  #render() {
    const { host, pages, onNavigate, onReload } = this.#props;
    if (!this.#root || !host || !pages || !onNavigate || !onReload) return; // still assembling props
    const { topBarSlot, ...restHost } = host;
    this.#root.render(
      <TyprenEditor
        host={{ ...restHost, topBarSlot: topBarSlot ? <DomSlot node={topBarSlot} /> : undefined }}
        pages={pages}
        slug={this.#props.slug}
        page={this.#props.page}
        version={this.#props.version}
        locale={this.#props.locale}
        layout={this.#props.layout}
        messages={this.#props.messages}
        onNavigate={onNavigate}
        onReload={onReload}
      />
    );
  }
}

if (!customElements.get("typren-shell")) customElements.define("typren-shell", TyprenShellElement);

/** Deprecated alias so pre-rename `meditor-shell` consumers (see the CMS
 *  package's predecessor) migrate gently. A custom element class can only be
 *  `define()`-d once, hence the trivial subclass rather than registering
 *  `TyprenShellElement` itself twice. */
class MeditorShellElement extends TyprenShellElement {
  connectedCallback() {
    console.warn("<meditor-shell> is deprecated, use <typren-shell> instead.");
    super.connectedCallback();
  }
}
if (!customElements.get("meditor-shell")) customElements.define("meditor-shell", MeditorShellElement);
