---
"@typren/core": patch
---

Bound front-matter writes by node count before dumping. Writes inline every shared object reference, so a ~1 KB editor payload built as a DAG of shared references expanded exponentially and exhausted the server's memory before the 256 KB size cap was checked. Such payloads, and circular ones, now fail fast with a "front matter too large" error; ordinary shared references (a duplicated slice) still save.
