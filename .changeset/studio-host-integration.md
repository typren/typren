---
"@typren/studio": minor
---

Fixes found embedding the studio in a Next App Router host. `@typren/studio` and `@typren/studio/ui` now start with `"use client"`, so server components can import `Skeleton`, `Button`, `Card` and the rest. `MediaGrid` renders Delete only with `onDelete` and not `readOnly`, and takes `copyUrl` for the URL its Copy action writes. New `MenuGroup`, `MenuLabel`, `MenuSeparator`, `DialogHeader` and `DialogDescription` exports. The studio's theme choice now also toggles `dark` on `<html>`, so host content follows it.
