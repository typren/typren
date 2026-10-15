---
"@typren/core": patch
---

Notion-to-markdown conversion now escapes `|` and a line made entirely of `=` or `-` characters, so plain Notion text can no longer render as a GFM table column, a setext heading underline, or a thematic break it never asked for. Asterisk/underscore thematic breaks were already covered by the existing metacharacter escaping.
