---
title: Navigation
description: The site doc's header menu, and the studio screen that edits it.
category: Guides
order: 27
---

A site's header menu can live in content, as a `nav` list in the site doc
(`content/site.md`). The studio's **Navigation** screen then edits it like a
page: as a draft, published when you say so.

## The site doc's menu

```yaml
---
nav:
  - label: Pricing
    href: /pricing
  - label: Products
    href: "#"
    children:
      - label: Payments
        href: /payments
      - label: API docs
        href: https://docs.example.com/
        external: true
cta:
  label: Contact us
  href: /contact
footer: { ... } # anything else in the doc is kept as it is
---
```

| Key | Meaning |
|---|---|
| `nav` | The menu, in order. Its presence, even as `nav: []`, is what turns the Navigation screen on. |
| `nav[].label` | The text a visitor sees. Required. |
| `nav[].href` | A site path (`/pricing`, `/about/`), a fragment (`#`, `#team`, often used for a parent that only opens its submenu) or an absolute `http(s)://` URL. |
| `nav[].external` | `true` for a link that leaves the site. Your header decides what that means, a new tab or an icon. |
| `nav[].children` | One level of submenu items, same shape. |
| `cta` | An optional header button, same shape without `children`. |

Keys the studio doesn't know are kept on each item, so a site can add its
own (an icon name, a badge).

Your site renders the header from this doc. Read it through the store, so
the preview shows the draft:

```ts
import { createStore, SITE_SLUG, type NavItem } from "@typren/core";

const store = createStore(adapter);
const site = preview ? ((await store.getDraft(SITE_SLUG)) ?? (await store.getPublished(SITE_SLUG))) : await store.getPublished(SITE_SLUG);
const nav = (site.meta.nav ?? []) as NavItem[];
```

A layout that reads `site.md` from disk shows only the published menu, so
the preview catches up when you publish (or, in a local checkout, push).

Renaming a page points the menu's links to it (and the `cta`) at its new
path, and deleting a page removes them, its submenu moving up, in both the
published menu and its draft. Both need the publish permission for the site
doc. A delete commits the menu with the page; a rename commits it right
after the move.

### Links are checked where they are written

The store refuses any draft of the site doc whose `nav` or `cta` holds a
link other than a site path, a fragment or an `http(s)` URL, so
`javascript:`, `data:` and protocol-relative `//host` links never reach a
header, whoever wrote them. `navHrefError(href)` gives the same verdict as
a sentence, and the studio shows it under the field.

## The Navigation screen

Website → **Navigation** shows the menu as a tree in the rail and the home
page beside the selected item's panel.

- **Edit** unlocks the menu. **+** adds an item; select one to change its
  label, its link (pick a page from the suggestions or type a URL) and
  whether it is external.
- Drag a row to reorder it. Drop it on the middle of a top-level row to put
  it in that item's submenu. The item's panel has the same moves as
  buttons: up, down, into the item above, out of the submenu, and remove.
- The **Button** row edits the `cta`, when the doc has one.
- Edits autosave to the draft about a second after you stop, and the
  preview reloads with it. The bar says when it last saved, and hovering
  that opens the site doc's version history. **Discard** drops the draft and
  **Publish** makes it live. In a local checkout **Review** takes their
  place: it pushes the menu as one `content: update navigation` commit, as
  for pages.

The Pages rail's **In navigation** group follows the published menu, so a
change shows there once it is published.

### Show in navigation

A page's settings popover has a **Show in navigation** toggle. Turning it
on adds the page to the end of the menu draft as a top-level item; turning
it off removes every item linking to the page, moving a removed item's
submenu up into its place. Arrange the result in Navigation.

## Sites whose menu is in code

Without a `nav` list in the site doc, the Navigation screen says the menu
is managed in the site's code, and the page toggle is read-only. The Pages
rail then groups pages by their own `nav: true` and `navOrder` front matter,
which a site doc with a menu overrides.
