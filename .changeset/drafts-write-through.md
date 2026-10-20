---
"@typren/core": patch
---

`ContentAdapter` gains an optional `draftsWriteThrough` flag, set by the Notion adapter. When it is set, `makeActions` authorizes draft writes (`saveDraft`, `createTranslation`) as `"publish"`, because a draft save on that adapter makes the content live. A role granted only `"saveDraft"` can no longer publish Notion-backed content.
