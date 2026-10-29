---
"typren": minor
---

`typren studio --local` asks for the local studio UI explicitly. In 0.6 it behaves exactly like no flag; in 0.7 the cloud studio becomes the default and `--local` keeps the local one. Without the flag, `typren studio` prints a one-line heads-up about the change on stderr.
