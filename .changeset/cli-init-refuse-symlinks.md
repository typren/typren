---
"typren": patch
---

`typren init` now refuses to write a scaffold file when the target or one of its parent directories is a symlink, instead of writing through a symlinked parent or, with `--force`, overwriting whatever a symlinked target points at.
