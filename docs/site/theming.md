---
title: Theming
description: The --typren-* CSS variable set the studio reads, and how to override it.
category: Guides
order: 24
---

Theming is the `--typren-*` CSS variable set shipped in
`@typren/core/theme.css`, and nothing else. There are no component-local
variables and no hardcoded colors in the studio — every themeable surface
reads one of these.

```ts
import "@typren/core/theme.css";
```

## The fallback chain

Each `--typren-*` variable falls back to the host's own shadcn token, then to
shadcn's default `neutral` oklch value — the same values `npx shadcn init`
writes:

```css
--typren-primary: var(--primary, oklch(0.205 0 0));
```

So:

- A shadcn site: the studio inherits its theme automatically, no config.
- A custom design system: override the `--typren-*` variables directly.
- No design tokens at all: the studio renders stock shadcn neutral.

Adding a variable to this set is additive — the resolution is a fallback
chain, so a host shipping an older or partial copy of `theme.css` still
works, just with fewer surfaces themed.

## The variables

| Variable | Falls back to | Purpose |
|---|---|---|
| `--typren-bg` / `--typren-fg` | `--background` / `--typren-text-primary` | base surface and text |
| `--typren-card` / `--typren-card-fg` | `--card` / `--card-foreground` | card surfaces |
| `--typren-popover` / `--typren-popover-fg` | `--popover` / `--popover-foreground` | popovers, dropdowns |
| `--typren-primary` / `--typren-primary-fg` | `--typren-fill-accent` / `--typren-text-on-accent` | primary actions |
| `--typren-secondary` / `--typren-secondary-fg` | `--secondary` / `--secondary-foreground` | secondary actions |
| `--typren-muted` / `--typren-muted-fg` | `--typren-fill-subtle-hover` / `--typren-text-secondary` | muted text and backgrounds |
| `--typren-accent` / `--typren-accent-fg` | `--accent` / `--accent-foreground` | hover/active accents |
| `--typren-destructive` | `--destructive` | destructive actions |
| `--typren-border` | `--typren-stroke-divider` | borders |
| `--typren-input` | `--input` | form control borders |
| `--typren-ring` | `--ring`, then `--typren-fill-accent` | focus rings |
| `--typren-app-bg` | `--typren-bg-base` | admin-shell backdrop the content card floats on |
| `--typren-sidebar` / `--typren-sidebar-fg` | `--typren-bg-base` / `--sidebar-foreground` | nav sidebar |
| `--typren-sidebar-accent` / `--typren-sidebar-accent-fg` | `--sidebar-accent` / `--sidebar-accent-foreground` | sidebar hover/active |
| `--typren-sidebar-border` | `--sidebar-border` | sidebar border |
| `--typren-sidebar-ring` | `--sidebar-ring` | sidebar focus ring |
| `--typren-sidebar-width` | `16rem` (literal) | sidebar width |
| `--typren-radius` | `--radius` | base radius; sm/md/lg/xl are derived from it, matching shadcn's Tailwind theme |

### The studio's surface roles

The studio's own chrome follows the structure of WinUI 3's Fluent tokens,
with WinUI's values (mostly translucent, so a control reads the same on any
layer), Typren's radii and a Typren-coral accent. The shadcn-named variables
above alias onto these.

| Variable | Falls back to | Role |
|---|---|---|
| `--typren-text-primary` / `-secondary` / `-tertiary` / `-disabled` | `--foreground` / `--muted-foreground` / none | text |
| `--typren-text-on-accent` | `--primary-foreground` | text on the accent |
| `--typren-fill-control` / `-hover` / `-pressed` | none | buttons, inputs, the search pill |
| `--typren-fill-control-input` | none | a focused text input |
| `--typren-fill-control-solid` | none | an opaque raised thumb |
| `--typren-fill-track` | none | the recessed track under a toggle group's thumb |
| `--typren-fill-subtle-hover` / `-selected` | none | rows, tiles and menu items; selected is a stronger step of the hover tint |
| `--typren-fill-accent` (`-hover`, `-pressed`) | `--primary` | primary buttons, focus rings, checkboxes |
| `--typren-stroke-control` / `-control-strong` | none | the hairline every control draws, and a stronger stroke for handles and swatch hovers |
| `--typren-stroke-card` / `--typren-stroke-divider` | `--border` | panel outlines, hairlines |
| `--typren-stroke-flyout` | none | menus, popovers, dialogs |
| `--typren-bg-base` | `--sidebar` | the frame |
| `--typren-layer` | `--background` | content panels raised on the frame |
| `--typren-card-bg` | none | cards inside a panel |
| `--typren-smoke` | none | the scrim behind a dialog |
| `--typren-elevation` / `-input` / `-accent` | none | the control hairline as an inset box-shadow; hover changes the fill and focus adds the ring |
| `--typren-shadow-flyout` | none | the shadow under a menu or popover |

The accent defaults to coral darkened in light (white text 5.3:1) and
lightened in dark (black text 7.9:1). Set `--primary` (or
`--typren-fill-accent`) to replace it.

`.dark` mirrors every mapping with shadcn's own dark `neutral` values, except the
accent and the focus ring, which keep reading the host's own
`--primary`/`--primary-foreground`/`--ring` so a themed site stays
recognizable in dark mode. The studio scopes `.dark` (and
`color-scheme`) to its own subtree, so it can theme independently of the
site around it.

### Radii and corners

The studio's shapes all derive from `--typren-radius`, so a host that changes
`--radius` moves every corner together.

| Variable | Default | Role |
|---|---|---|
| `--typren-radius-control` | `--typren-radius × 1.2` | buttons, inputs, rows, menus |
| `--typren-radius-card` | `--typren-radius × 2.4` | panels, popovers, dialogs, gallery tiles |
| `--typren-radius-sm` | `--typren-radius × 0.4` | small marks that nest in nothing: name pills, tags, image corners, tooltips |
| `--typren-inset-card` | `--typren-radius × 1.2` | a card's padding, which leaves its controls concentric |
| `--typren-radius-outer` / `--typren-inset` | `--typren-radius-control` / `4px` | the parent radius and gap a `.typren-concentric` child derives from |
| `--typren-radius-min` | `4px` | the floor of a derived radius |
| `--typren-corner-scale` | `1` (`1.5` with corner smoothing) | optical size correction for squircle corners |

Nested corners are concentric: a surface inset inside a rounded one takes the
outer radius minus the gap, so the band between the two curves stays even
round the corner. `.typren-concentric` computes
`max(--typren-radius-min, --typren-radius-outer − --typren-inset)` from the
nearest values; the defaults fit an item 4px inside a control-radius surface,
such as a menu item or a toggle thumb. Since the card radius is twice the
control radius, a card padded by `--typren-inset-card` holds controls
concentrically with no extra work.

Where the browser supports `corner-shape` (Chromium 139+, Firefox 161+), the
editor draws squircle corners, the superellipse iOS and Figma's corner
smoothing use. A squircle reads smaller than a circular arc of the same
radius, so the token radii scale by `--typren-corner-scale`, and the
concentric gap scales with them. The Style screen's previews of the site's own radius
stay circular, as the site draws them. Other browsers keep circular corners at the
unscaled radii; layout is the same in both. Fully round shapes
(`rounded-full`) stay round.

## Overriding

```css
/* globals.css, after importing @typren/core/theme.css */
:root {
  --typren-primary: oklch(0.52 0.2 260);
  --typren-primary-fg: oklch(0.98 0 0);
  --typren-radius: 0.5rem;
}
```

Override `--typren-*` variables directly for a studio-only change, or
`--primary`/`--radius`/etc. (shadcn's own tokens) to theme both the site and
the studio from one source.

## The site's style (Website → Style)

The studio's Style screen edits a second, separate set: the site's own style
tokens (`STYLE_TOKENS` in `@typren/core`: colours, fonts, sizes, radius,
spacing), saved in the site settings. A site emits the saved values with
`TyprenStyle`, a server component that reads the published settings and
renders them as a `<style>` React hoists into `<head>`:

```tsx
// app/layout.tsx, inside <html>
import fs from "node:fs";
import path from "node:path";
import { createSettingsStore } from "@typren/core";
import { TyprenStyle } from "@typren/core/ui/typren-style";
import { cmsConfig } from "@/cms.config";

const settings = createSettingsStore(cmsConfig);
const map = JSON.parse(fs.readFileSync(path.join(process.cwd(), "typren.config.json"), "utf8")).studio?.style;

<TyprenStyle store={settings} map={map} />
```

Read the map from `typren.config.json` with `fs` on the server, the way
`cms.config.ts` reads the locales, rather than `import` it: the file sits at
the project root, outside `src/`, and a read picks up a changed map without a
rebuild. Under `output: "export"` the read runs at build time. For the CSS
string alone, `resolveStyleCss(settings, map, locale)` from the same module
returns it, empty when nothing is saved; `styleCss(style, map)` from
`@typren/core` does the same for a style object you already hold.

`typren init` scaffolds this as `site-style.tsx` and renders it from
`SliceZone`, so every content page carries the saved style. Render
`<SiteStyle />` in the root layout as well if other routes should follow it.

Each set token is written under its `--typren-*` name and under the site
custom property it maps to, in a `:root:root` rule that outranks the site's
own `:root` and `.dark` blocks whatever order the stylesheets load in. Keep
the rule unlayered; only `!important` or an inline style on `<html>` beat it.

The map defaults to the stock shadcn names (`STYLE_MAP_DEFAULT`), so a
shadcn site needs no config:

| Token | Default site property |
|---|---|
| `--typren-bg` | `--background` |
| `--typren-fg` | `--foreground` |
| `--typren-primary` | `--primary` |
| `--typren-primary-fg` | `--primary-foreground` |
| `--typren-secondary` | `--secondary` |
| `--typren-accent` | `--accent` |
| `--typren-muted` | `--muted` |
| `--typren-border` | `--border` |
| `--typren-font-body` | `--font-sans` |
| `--typren-radius` | `--radius` |

A site with its own names sets `studio.style` in `typren.config.json`. The
map replaces the default, so list every token the site should follow; a
token left out, or mapped to itself, is written as `--typren-*` only:

```json
{
  "studio": {
    "style": {
      "--typren-primary": "--brand",
      "--typren-bg": "--page",
      "--typren-accent": "--surface-raised",
      "--typren-font-body": "--font-copy"
    }
  }
}
```

Names must be lowercase custom properties (`--[a-z0-9-]+`); `typren studio`
refuses to start on anything else. The Style screen reads each token's
current value from its mapped property in the preview, so an unset token
shows the site's own value, labelled "From site". Type tokens with no
mapping are read from the site's computed `body` and heading styles.

A shadcn site that stores colours as bare HSL components
(`--primary: 222 47% 11%`, read as `hsl(var(--primary))`) can't take a
full colour under `--primary`: map its colour tokens to themselves, or to
new names its CSS reads.
