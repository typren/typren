---
"@typren/core": patch
---

`generateLlmsFullTxt` leaves out `noindex` pages and the markdown mirror route 404s them, so a page kept out of search no longer reaches AI crawlers through the AIO surfaces. Mirror responses carry `X-Robots-Tag: noindex` so the `.md` copy never competes with the HTML page in search.
