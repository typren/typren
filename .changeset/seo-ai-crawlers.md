---
"@typren/core": minor
---

`DEFAULT_AI_CRAWLERS` now names the current answer-engine and user-fetch agents: OAI-SearchBot, Claude-SearchBot, Claude-User, Perplexity-User, Applebot-Extended, Meta-ExternalAgent and Amazonbot join the list, and the retired Claude-Web and anthropic-ai user agents leave it. Sites that pass their own `aiCrawlers` are unaffected.
