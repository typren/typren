---
"@typren/editor": patch
---

The live-preview iframe is now sandboxed (`allow-scripts allow-forms`, no `allow-same-origin`), so script in
draft content runs in an opaque origin and cannot reach the editor's session. The editor accepts bridge messages
only from its own preview frame. A preview route whose code reads `localStorage`/`document.cookie` must tolerate
those throwing, and fonts served to it need CORS headers.
