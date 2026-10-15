---
"typren": patch
"@typren/core": patch
---

`typren migrate` resolved the installed `@typren/core`'s `package.json` with `require.resolve(..., { paths: [cwd] })`, which throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because core's `exports` map never listed `./package.json` — crashing `migrate` on every project. It now locates the file by walking `node_modules` directly. `@typren/core`'s `exports` map also now lists `./package.json`, for any other caller relying on Node's own resolution.
