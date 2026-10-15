---
"@typren/core": patch
---

SVG upload sanitization now strips `style` attributes and `<style>` elements, and drops any attribute whose value contains an external `url(...)` reference (a `fill`, `filter`, `clip-path`, `mask`, etc. pointing off-document). A same-document fragment reference (`url(#id)`) is kept. Closes a CSS-based tracking/exfiltration vector that survived the existing `<script>`/event-handler/`href` sanitization.
