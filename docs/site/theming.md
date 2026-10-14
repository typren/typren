---
title: Theming
description: The --typren-* CSS variable set the editor reads, and how to override it.
category: Guides
order: 24
---

Theming is the `--typren-*` CSS variable set shipped in
`@typren/core/theme.css`, and nothing else. There are no component-local
variables and no hardcoded colors in the editor — every themeable surface
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

- A shadcn site: the editor inherits its theme automatically, no config.
- A custom design system: override the `--typren-*` variables directly.
- No design tokens at all: the editor renders stock shadcn neutral.

Adding a variable to this set is additive — the resolution is a fallback
chain, so a host shipping an older or partial copy of `theme.css` still
works, just with fewer surfaces themed.

## The variables

| Variable | Falls back to | Purpose |
|---|---|---|
| `--typren-bg` / `--typren-fg` | `--background` / `--foreground` | base surface and text |
| `--typren-card` / `--typren-card-fg` | `--card` / `--card-foreground` | card surfaces |
| `--typren-popover` / `--typren-popover-fg` | `--popover` / `--popover-foreground` | popovers, dropdowns |
| `--typren-primary` / `--typren-primary-fg` | `--primary` / `--primary-foreground` | primary actions |
| `--typren-secondary` / `--typren-secondary-fg` | `--secondary` / `--secondary-foreground` | secondary actions |
| `--typren-muted` / `--typren-muted-fg` | `--muted` / `--muted-foreground` | muted text and backgrounds |
| `--typren-accent` / `--typren-accent-fg` | `--accent` / `--accent-foreground` | hover/active accents |
| `--typren-destructive` | `--destructive` | destructive actions |
| `--typren-border` | `--border` | borders |
| `--typren-input` | `--input` | form control borders |
| `--typren-ring` | `--ring` | focus rings |
| `--typren-app-bg` | `--sidebar` | admin-shell backdrop the content card floats on |
| `--typren-sidebar` / `--typren-sidebar-fg` | `--sidebar` / `--sidebar-foreground` | nav sidebar |
| `--typren-sidebar-accent` / `--typren-sidebar-accent-fg` | `--sidebar-accent` / `--sidebar-accent-foreground` | sidebar hover/active |
| `--typren-sidebar-border` | `--sidebar-border` | sidebar border |
| `--typren-sidebar-ring` | `--sidebar-ring` | sidebar focus ring |
| `--typren-sidebar-width` | `16rem` (literal) | sidebar width |
| `--typren-radius` | `--radius` | base radius; sm/md/lg/xl are derived from it, matching shadcn's Tailwind theme |

`.dark` mirrors every mapping with shadcn's own dark `neutral` values, except
`--typren-primary`/`--typren-primary-fg`/`--typren-ring`, which keep reading
the host's own `--primary`/`--primary-foreground`/`--ring` so a themed site
stays recognizable in dark mode. The editor scopes `.dark` (and
`color-scheme`) to its own subtree, so it can theme independently of the
site around it.

## Overriding

```css
/* globals.css, after importing @typren/core/theme.css */
:root {
  --typren-primary: oklch(0.52 0.2 260);
  --typren-primary-fg: oklch(0.98 0 0);
  --typren-radius: 0.5rem;
}
```

Override `--typren-*` variables directly for an editor-only change, or
`--primary`/`--radius`/etc. (shadcn's own tokens) to theme both the site and
the editor from one source.
