# @typren/core

## 0.1.1

### Patch Changes

- Patch sharp to close four high-severity libvips CVEs (CVE-2026-33327,
  CVE-2026-33328, CVE-2026-35590, CVE-2026-35591). The fix shipped in sharp
  0.35.0, which `^0.34.5` could never reach, so this raises the range to
  `^0.35.3`.
  
  sharp 0.35 also folded AVIF detection into its heif decoder, so an AVIF upload
  now reports format `heif` with compression `av1` rather than a dedicated
  `avif` format. The upload guard checks compression alongside format, which
  keeps AVIF passthrough working without silently starting to accept plain HEIC.
  
  Adds a package README, so the npm page describes the package instead of
  showing nothing.
