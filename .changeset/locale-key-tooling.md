---
"@typren/locale": minor
---

`typren-locale` gains three verbs for catalogue hygiene: `scan` finds keys the source never references (presets for vue-i18n, i18next, react-intl and typren), `check` reports missing, empty and extra values per locale, and `lint` validates message syntax and placeholders for ICU, vue-i18n, i18next or typren, with `--to typren` as a migration-readiness gate. Every verb now accepts `--json`, and the build config takes an optional `defaultLocale`.

Breaking: usage errors and pull, bake and compat failures now exit 2 instead of 1, and unknown flags are rejected on pull, bake, diff and doctor (compat still accepts them).
