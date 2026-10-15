---
"@typren/forms": patch
---

The `hubspot` sink now reads `hutk` from the request's `hubspotutk` cookie instead of the submission body, matching the documented guarantee. A submitter could previously claim an arbitrary HubSpot tracking identity by putting any value in the `hutkField`-named form field.
