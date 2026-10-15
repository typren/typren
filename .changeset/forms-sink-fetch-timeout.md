---
"@typren/forms": patch
---

Every fetch-backed sink (`webhook`, `hubspot`, `google-sheets`) now aborts its request after a 10-second default timeout (override with `SinkRuntime.timeoutMs`), so a slow or unresponsive receiver can no longer pin a form submission handler open.
