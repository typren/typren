---
"@typren/locale": patch
---

Two fixes surfaced by the first real consumer integration. The Lokalise preset's `poll.idPath` now reads `process_id` from the top level of the create response (verified against the live API: the `process` wrapper exists only on the poll response, not the create response — the preset had conflated the two shapes and every real export failed to start). And `compat lokalise2` now bridges the literal token it legitimately reads from a vendor `config.yml` through a compat-owned environment variable (`TYPREN_LOCALE_COMPAT_TOKEN`) instead of placing the literal in the provider config, which the provider's secrets policy rejects by design; the secret still never touches disk or logs.
