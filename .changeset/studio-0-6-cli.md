---
"typren": minor
---

Breaking: the studio no longer lives inside the site. `typren init` scaffolds the site side only (no `next.config.ts` rewrite, `cms-actions.ts` or media upload route), and `apply-settings` only validates `typren.config.json` and checks `cms.config`; it writes nothing. `typren studio` looks for `@typren/studio-local`, the renamed local host. Run `typren migrate` for the steps.

What's new:

- **`typren studio`** starts the studio for the site in the current directory on `127.0.0.1:4400` (`--port`) and its own preview copy of the site's dev server (`TYPREN_PREVIEW=1`, on `--preview-port`), or frames a running site with `--site-url`. Site facts come from the `studio` block of `typren.config.json` (`contentDir`, `slicesDir`, `media`, `homeSlug`, `style`, `nestedLayouts` and more), validated at start-up; paths that are absolute or climb out of the site are refused.
- **Content commands.** Every studio action is a command: `page`, `template`, `section`, `media`, `settings`, `style`, `nav`, `save`, `publish` and `status`. They share core's code, take `--json`, never prompt, and exit 2 on a version conflict.
- **`typren changes list|push|discard|log`** lists saved changes and page drafts not pushed yet, pushes only some (one commit per page), undoes files in a new commit, and prints a page's version history.
