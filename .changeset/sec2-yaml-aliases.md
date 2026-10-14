---
"@typren/core": patch
"typren": patch
---

Front matter now refuses YAML aliases (`*ref`) and blocks over 256 KB, so a content file can no longer
expand into gigabytes of objects (billion laughs) when it is parsed. Timestamps, merge keys and every other
value parse exactly as before.
