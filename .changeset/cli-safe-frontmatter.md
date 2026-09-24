---
"typren": patch
---

`typren review` refuses gray-matter's `javascript` front-matter engine, which
eval()s the front-matter block: review runs on writer-supplied markdown, and
content is data, never code.
