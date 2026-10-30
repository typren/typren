---
"typren": minor
---

Breaking: `typren studio` now opens the studio UI from the cloud by default. It serves only the content API from the CLI process, on `127.0.0.1`, for the cloud origin alone and with a per-session pairing token carried in the link's `#fragment`, and opens `<cloud>/connect`. No second Next.js app runs on your machine, and content never goes through the cloud. `--local`, accepted since 0.6, now keeps the previous behaviour, the studio UI on `127.0.0.1:4400` from `@typren/studio-local`, which is now needed only for `--local`. `--cloud-url <url>` (or `TYPREN_CLOUD_URL`) points it at another cloud origin. The preview copy's `TYPREN_STUDIO_ORIGIN` is the cloud origin in the default mode. The 0.6 heads-up line on stderr is gone.
