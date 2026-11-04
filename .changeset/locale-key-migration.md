---
"@typren/locale": minor
---

Gradual key rename and decommission. An `_aliases.json` next to the catalogs maps old keys to their replacement (or `null` to decommission). `t()` takes an optional alias resolver that falls back to the target key and warns once per old key outside production (`onDeprecatedKey` hook for production telemetry), with structural adapters for vue-i18n's `missing` handler and i18next's `parseMissingKeyHandler`. `bake` serves aliased old keys as copies of their targets so installed builds keep resolving them over OTA, `pull --emit-aliases` writes the same copies for libraries without a hook, and the files provider ignores `_aliases.json`. New CLI verbs `rename`, `deprecate` and `prune-aliases` (with `--json`; exit 0 ok, 1 refused, 2 usage or failure). `scan` reports alias old keys still referenced in source as `deprecated` (a warning, or an error once `removeAfter` has passed), and the alias verbs report failures in the same `--json` shape as the other verbs.
