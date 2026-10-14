---
"@typren/adapter-media-s3": patch
---

`createS3MediaAdapter`'s `prefix` option, if set, must now be non-empty and
end in `/`. Without the trailing slash, a prefix like `"siteA"` also matched
the key `"siteAB/x"` (`startsWith`), so one site's adapter could list or
delete another site's objects in a shared bucket. `"siteA/"` can't.
