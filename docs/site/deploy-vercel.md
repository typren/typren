---
title: Deploy to Vercel
description: Run a Typren site on Vercel, with GitHub-backed content or a static export.
category: Guides
order: 20
---

Typren has no Vercel-specific adapter. You deploy it the same way you deploy
any Next.js App Router project: push the repo, let Vercel build it. This page
covers the two things Vercel changes for a Typren site: which content tier
you pick, and what to do about `typren-drafts` if you use the GitHub adapter.

## Content tier

Pick a tier before you deploy, since it changes what Vercel needs to know
about.

- **Git static** (`createMarkdownAdapter`, the default from `typren init`):
  content ships inside the repo and the build reads it from disk. No extra
  configuration for Vercel; a content change needs a redeploy to go live.
- **Git runtime** (`createGithubAdapter`): the deployed site reads content
  from GitHub at request time instead of from the build's own checkout. See
  [Live content from GitHub](./live-content-github.md) for the adapter and
  webhook wiring; the only Vercel-specific piece is the Ignored Build Step
  below.

## Skip builds for the drafts branch

`createGithubAdapter`'s `draftBranch` defaults to `"typren-drafts"`: every
draft save commits there, not to the branch your site builds from. Vercel
builds every branch it sees pushed by default, so without this step each
draft save triggers a wasted preview build.

In the Vercel project's **Settings → Git → Ignored Build Step**, set:

```bash
if [ "$VERCEL_GIT_COMMIT_REF" = "typren-drafts" ]; then exit 0; else exit 1; fi
```

Exit `0` skips the build; exit `1` lets it proceed. If you passed
`draftBranch: null` to `createGithubAdapter` (the pre-0.5 layout, drafts
living under `draftSubdir` on the same branch as published content), there is
no separate branch to ignore, and every draft save lands on your production
branch and triggers a production build. Keep the default `draftBranch` unless
you have a reason not to.

> **Security:** the Ignored Build Step above stops a *production* deploy from
> picking up drafts, but Vercel still builds the `typren-drafts` branch as a
> **Preview Deployment** by default, and a Preview Deployment URL is public
> unless you've changed that. An unpublished draft is reachable by anyone who
> has (or guesses) the preview URL, even though it never reaches production.
> Close this with one or both of:
>
> - Also exclude the drafts branch from Preview Deployments: **Settings →
>   Git → Preview Deployment Suppression**, add the `typren-drafts` branch
>   (or set Preview Deployments to only build specific branches and leave it
>   out).
> - Turn on **Settings → Deployment Protection** (Vercel Authentication or
>   Password Protection) so every preview, drafts branch or not, requires
>   auth to view.
>
> Either is enough on its own; doing both is the belt-and-suspenders option
> if some drafts are sensitive enough to warrant it.

## Auth and media

Vercel doesn't constrain which `AuthAdapter` or media backend you use. See
[Choosing an auth adapter](./choosing-auth.md) and
[Media storage](./media-storage.md). `@typren/core`'s `sharp`-based
`processUpload`, which runs before any `MediaAdapter` stores a file, needs a Node runtime (Vercel's default Next.js runtime, not
the Edge runtime) for the upload path specifically; `list()`/`delete()` and
read-side rendering have no such constraint.

> **Cost:** a git-runtime site calls the GitHub Contents API on every
> uncached read. Cache reads with `readInit` (see
> [Live content from GitHub](./live-content-github.md#caching-reads)) so a
> page load doesn't cost a GitHub API call on every visitor request.
