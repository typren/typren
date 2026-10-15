---
"typren": patch
---

`typren init` now binds `package.json`'s `dev` script to loopback (`next dev -H 127.0.0.1`), which the scaffolded `localAuth()` requires. The docs already claimed it did; it only printed advice, and `next dev` listens on all interfaces by default. A script it can't safely rewrite is left alone with a warning.
