---
"@typren/core": patch
---

Content parsing now refuses JavaScript front matter (`---js` / `---javascript`) in the markdown and GitHub
adapters, so a content file can never execute code when it is parsed.
