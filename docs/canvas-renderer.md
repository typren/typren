# Persistent canvas with renderer adapters

Status: phase 2 built (handshake, nonce, `document`/`patch`, React renderer,
client sections, legacy fallback); phases 3 to 5 not yet built. Builds on [editor-v3.md](editor-v3.md) (studio
beside the site) and the section canvas in [studio.md](site/studio.md#4-render-one-section-optional).

## Problem

The studio previews a page by framing its real route. Every page switch, Edit
toggle and autosave changes the frame's `src` or `reloadKey`, so the frame
reloads: about a second of blank or stale preview each time. Editing chrome
(outlines, toolbar, insertion points) lives in the studio as an overlay placed
from `rects` the bridge posts once per animation frame, so it trails the page
by at least a frame whenever the page scrolls.

## Decision: keep the iframe, borrow Storybook's renderer idea

Rendering site components in the studio itself (Storybook's engine, or the
studio compiling site code) was rejected. The frame gives the page its own
viewport, so device widths and media queries are real; it isolates CSS and JS
both ways; and it runs on the site's own server, which server-only components
and RSC need, with the site's exact fonts, variables and layout. What
Storybook gets right is the *persistent preview*: one page loaded once, a
framework renderer inside it, and a channel that swaps what it renders
without reloading. This design takes only that.

## 1. The persistent canvas page

The site's existing section canvas route (`/typren/section`, mounted with
`createSectionCanvas`) gains a page mode. The studio loads it once per session
and keeps it: page switches, Edit toggles, prop edits, locale switches and
slice add, remove or reorder all become messages, never navigations. No new
route is added.

The real-route frame stays, with today's reloads, in three places: Browse mode
(following the site's own links), an "Open real page" fidelity check, and
pages under a nested layout. The canvas renders slices under the root layout
only, so a page whose route adds its own layout (a blog post wrapper, say)
would look different there; those pages keep exact fidelity on the real route
instead. The site lists such route prefixes in its studio block, and the
studio frames them the old way. ponytail: a per-template `shell` component
rendered around the slices in the canvas would bring those pages onto it too;
add it if the reload on those pages proves to matter.

The studio owns the document; the canvas only renders it. Every slice carries
a key the studio assigns per session (not stored in content), so a reorder
moves a mounted section instead of remounting it.

### Protocol

All messages keep today's `{ __typren: true, type }` envelope.

| Direction | Message | Meaning |
|---|---|---|
| canvas → studio | `hello { protocol, renderers, server }` | Ready; which protocol version, renderers and server rendering it supports. |
| studio → canvas | `document { rev, page, locale, slices }` | Replace everything (page switch, locale switch). |
| studio → canvas | `patch { rev, base, ops }` | `set`, `insert`, `remove`, `move` by slice key; ignored unless `base` is the canvas's current `rev`, which then asks for a full `document`. |
| studio → canvas | `chrome`, `select`, `theme`, `style` | Editing chrome state and tokens, plus the existing theme and Style messages. |
| canvas → studio | `rendered { rev, ms }`, `missing { keys }`, `error { key }` | Paint acknowledgement and timing, slices it cannot render, a section that threw. |
| canvas → studio | `hover`, `select`, `move`, `insert`, `edit` | Editing intents (see section 4). |

**Origin pinning and a session nonce.** As today, the canvas talks only to
`window.parent` at `TYPREN_STUDIO_ORIGIN`, and the studio identifies the frame
by `event.source` and origin (`fromFrame`). The studio also puts a random
nonce in the frame URL's fragment (never sent to the server), and every
message carries it both ways. This closes the `ponytail:` in `postToFrame`,
where an opaque frame can only be addressed with `"*"`.

**Sanitising.** Posted slices pass exactly the checks of `parseSectionQuery`
(known registry key, no `__proto__` or raw-HTML keys, no script URLs under
link-like keys), applied to the structured-clone value, plus caps on count
(500, as `toPlaces`), depth and size. The check lives in core beside
`parseSectionQuery`, not in each renderer: the canvas is the trust boundary.

**Versioning and fallback.** `protocol` is an integer; the studio speaks the
lower of the two. A canvas that sends no `hello` within three seconds (an old
core, a site without the route, a crashed page) puts the studio back on
today's behaviour: frame the real route and reload on change. Both paths stay
until the minimum supported core speaks protocol 1.

## 2. Renderer adapters

Inside the canvas, a renderer mounts one framework component into one element.
Following repository doctrine, it is an interface plus a factory, no classes:

```ts
export interface MountedSection {
  update(props: Record<string, unknown>): void;
  unmount(): void;
}

export interface RendererAdapter<C = unknown> {
  readonly name: string; // "react", "vue", ...
  mount(el: HTMLElement, component: C, props: Record<string, unknown>): MountedSection;
}

export function createCanvas<C>(opts: {
  renderer: RendererAdapter<C>;
  registry: Record<string, C>; // client-renderable slices
  server?: ServerSections; // section 3
}): CanvasHandle;
```

A site registers its registry where it mounts the canvas today, in one file:

```tsx
// app/typren/section/canvas.tsx
"use client";
import { createCanvas } from "@typren/core/ui/canvas";
import { createReactRenderer } from "@typren/core/ui/canvas-react";
import { registry } from "@/slices/registry";
export default createCanvas({ renderer: createReactRenderer(), registry });
```

- **React (first party).** No root per section, which would cut sections off
  from the layout's providers: `mount` registers a slot the canvas's own React
  tree fills with a portal, so root-layout providers reach every section.
- **Vue.** `createApp(component, reactive(props))`; `update` assigns into the
  reactive object, and an optional `setup(app)` installs the site's plugins.
- **Svelte 5.** `mount(component, { target, props })` with `$state` props;
  `update` assigns into them, `unmount` calls Svelte's `unmount`.
- **Astro.** `.astro` components render only on the server, so an Astro site
  is mostly a server-section site (section 3). Islands inside a fragment
  hydrate themselves when inserted, provided the island runtime is loaded on
  the canvas page (to verify per Astro version).

Each renderer is checked by a `createRendererContractSuite` in
`@typren/contract-tests`: mount, update without remount, unmount without
leaks, a throwing section isolated.

## 3. Server-only sections and RSC

A slice whose type is in the client registry updates in place, in the same
frame. Any other known slice is a server section: the canvas asks the site's
server to render it and swaps the result into that slice's slot, keeping the
previous output on screen until the new one arrives (no flash, no layout jump).
Requests are per slice, debounced (about 150ms trailing) and abortable.

```ts
export interface ServerSections {
  render(slices: Slice[], signal: AbortSignal): Promise<Record<string, Fragment>>;
}
```

- **Next.js App Router:** a server action returns the rendered slices as React
  elements, so async and server-only components arrive as an RSC payload and
  the React renderer places them in their slots.
- **Other frameworks:** a `POST` endpoint on the canvas route returns an HTML
  fragment per key. `POST` avoids the URL limit the `?slices=` grid hits today.

Both keep the section canvas's gate (`TYPREN_PREVIEW=1`, never in a production
build) and the same sanitiser; the endpoint also requires a custom header, so
a foreign page cannot call it without a CORS preflight it fails. A site with a
server-only legal section then sees its edits after a short delay, not a
reload.

**Static export sites** have no server rendering at preview time: Next refuses
server actions and request-time rendering under `output: "export"`. They get the
client registry only, and a server-only slice shows a schematic placeholder
that reads "renders on save". That is the documented ceiling; the existing
remedy still applies (turn export off for the preview copy only).

## 4. Editing chrome inside the canvas

Chrome moves from the studio's overlay into the canvas document, in a shadow
root (`<typren-chrome>`) appended to `body`:

- **Zero scroll lag by construction.** Outlines are positioned in document
  coordinates and recomputed on resize, mutation and render, not on scroll,
  so the compositor scrolls them with the page. Only slices inside fixed or
  sticky ancestors are re-measured on scroll, in the same document and frame.
- **Pointer events.** The layer is `pointer-events: none`; only its handles
  (toolbar, drag grip, insertion buttons) take `auto`. Hover and click are
  read with capture-phase listeners on the document, as the bridge does, so
  the site's own hover states keep working.
- **Theming.** The studio posts `chrome { tokens }`; names pass the same
  `CUSTOM_PROPERTY` check as the Style message and are set on the shadow
  host, which resets with `:host { all: initial }`, so neither side's CSS
  leaks into the other.
- **Events, not mutations.** Hover, select, drag-reorder (`move { key, to }`)
  and insertion (`insert { at, rect }`) are posted to the studio, which
  changes the document and answers with a `patch`. Panels, forms and rich
  menus stay in the studio; an insertion menu opens once at the posted rect
  and closes on scroll rather than tracking it.

The frame agent is building the first slice of this in the preview bridge now
(outlines and hover drawn in-frame); the canvas reuses that code.

## 5. Optional Storybook source

A site that already has Storybook can feed the canvas from its stories:

- **As a registry source.** A helper reads CSF modules, using each default
  export's `component` as a registry entry and its stories' `args` as default
  props and template seeds. Cheap, no extra process.
- **As a preview source.** Storybook's own preview page already updates args
  in place over its channel, so the Templates gallery could frame it when the
  site has no section route.

It costs fidelity and coupling: stories render under Storybook decorators,
not the site's layout; `args` are not slice schemas; the preview is a second
dev server; and its channel is internal API that moves between majors. Skip it
when stories do not map one to one onto slices. It is never required, and it
is not a planned phase: it gets built only when a real site needs it.

## 6. Migration

| Phase | Scope | Acceptance |
|---|---|---|
| 0 | Instrument today's page switch, Edit toggle and prop edit. | Baseline numbers recorded in this doc. |
| 1 | Chrome in the canvas (in progress in the bridge). | No visible outline lag during trackpad and inertial scroll at 120Hz; the studio overlay is unused for protocol 1 frames. |
| 2 | Handshake, nonce, `document`/`patch`, React renderer, client sections; legacy fallback. | Page switch visible in under 100ms (p95, 10-section page, local dev); Edit toggle and locale switch cause no navigation; a client prop edit paints within one frame of the message. |
| 3 | Server sections: RSC action for Next, HTML endpoint for the rest. | Server-section prop edit visible in under 300ms after the debounce; old output stays until the swap. |
| 4 | Vue, Svelte and Astro renderers with the contract suite. | Each passes the suite on a fixture site. |
| 5 | Retire the reload path for editing. | Minimum supported core speaks protocol 1. |

### Risks

- **Fidelity.** Page-level markup outside a page's slice zone, on a route the
  site did not list as nested, looks different in the canvas than on the real
  route. Listing the route moves it back to the real-route frame.
- **Long-lived page state.** Site code that assumes a fresh load (analytics,
  run-once animations, global listeners) can misbehave or leak across
  switches. Mitigation: per-section error boundaries posting `error`, and a
  silent canvas reload after many switches or a fatal error.
- **Hot reload.** Site code edits must refresh the registry in the live canvas
  (Fast Refresh, Vite HMR); a reloaded canvas sends `hello` and gets the
  document again.

## Decisions

Decided by Gabriel:

1. Page mode extends `/typren/section`: one route, one scaffold, one gate.
2. Pages under a nested layout fall back to the real-route frame and keep its
   reload, for exact fidelity. A per-template `shell` is a possible later
   upgrade, not part of this design.
3. Browse mode stays on the real-route frame; it does not move to the canvas.
4. The Storybook source stays optional and is built only when a real site
   needs it.

Decided by default (the proposals above), revisit if needed:

5. Static export sites show a "renders on save" placeholder for server-only
   slices rather than reloading after each autosave.
6. Slice keys are per session and never stored in content.
7. The legacy reload path for editing retires once the minimum supported core
   speaks protocol 1.
