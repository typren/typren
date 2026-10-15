---
"@typren/core": patch
---

The GitHub webhook handler now records a delivery id as processed only after `onChange` succeeds, so GitHub's
retry of a delivery whose `onChange` failed is processed instead of being dropped as a replay.
