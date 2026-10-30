---
title: "@typren/contract-tests reference"
description: Conformance suite factories for ContentAdapter, static-host routing, the studio API and preview-bridge.
category: Reference
order: 58
---

`@typren/contract-tests` ships Vitest-based conformance suites as factories: pass in your
implementation, get a `describe` block that asserts the contract. Core runs every suite against
its own reference implementations (markdown, GitHub, Notion adapters; the static-host routing
each host adapter wires up); a new adapter should run the matching suite in its own test file
too. See [writing-an-adapter](./writing-an-adapter.md) for when to reach for each one.

This package ships source directly (`exports["."] = "./src/index.ts"`, no build step) and has no
runtime dependencies.

## "."

| Export | Signature | Notes |
|---|---|---|
| `createContentAdapterContractSuite` | `(makeAdapter: () => ContentAdapterLike, seed?: ContentAdapterContractSeed) => void` | Conformance suite for any `ContentAdapter`. |
| `ContentAdapterLike` | type | Structural restatement of core's `ContentAdapter` (kept dependency-free of `@typren/core`; any real `ContentAdapter` satisfies it structurally). |
| `ContentAdapterContractSeed` | type | See Options below. |
| `createStaticHostRoutingContractSuite` | `(name: string, run: StaticHostRunner) => void` | Conformance suite for the trailing-slash static-export routing shape. |
| `createBareUrlStaticHostRoutingContractSuite` | `(name: string, run: StaticHostRunner) => void` | Same contract for Next's bare-URL export shape (`trailingSlash: false`). |
| `StaticHostRunner` | `(req: { path: string; query?: string; redirects?: Record<string, string>; storeDown?: boolean }) => Promise<StaticHostOutcome>` | The thing under test: your router's decision function. `query` is raw (no leading `"?"`); `redirects` is the store's full key→target map for that case; `storeDown: true` makes every lookup reject. |
| `StaticHostOutcome` | `{ status: 301; location: string } \| { serve: string }` | A redirect or a resolved object path to serve. |
| `createRouteContractSuite` | `(getHandler: () => ApiHandler, seed?: RouteContractSeed) => void` | Conformance suite for the studio's HTTP API (`createTyprenApi`'s routes). |
| `ApiHandler` | `(request: Request) => Promise<Response>` | |
| `RouteContractSeed` | `{ basePath?: string; baseUrl?: string }` | `basePath` must match the handler under test's own `basePath`. |
| `ROUTE_CONTRACT` | `RouteFixture[]` | Every documented route (method, path template, body keys, query params, description) for `createTyprenApi`. Kept in sync with `routes.ts`'s own doc comment by hand, not generated. |
| `RouteFixture` | `{ method: "GET" \| "POST" \| "PUT" \| "DELETE"; path: string; body?: string[]; query?: string[]; description: string }` | One route's expected shape. |
| `createPreviewBridgeContractSuite` | `(initPreviewBridge: InitPreviewBridge) => void` | Conformance suite for the preview-bridge `postMessage` protocol. |
| `InitPreviewBridge` | `() => () => void` | Mounts the bridge, returns its teardown. |
| `BridgeMessage` | type | The union of message shapes the bridge sends/receives (`select`, `edit`, `theme`, `scrollTo`, `rects`, `hover`). |
| `BRIDGE_MESSAGE_FIXTURES` | `BridgeMessage[]` | Fixtures the suite round-trips. |

### `ContentAdapterContractSeed`

| Option | Type | Default | Notes |
|---|---|---|---|
| `slug` | `string` | `"typren-contract-test"` | A slug the suite is free to write/delete; must not be used by anything else the adapter under test holds. |
| `secondSlug` | `string` | `"typren-contract-test-2"` | A second slug for the two-slug ordering (`listSlugs`) check. |
| `draftsWriteThrough` | `boolean` | `false` | Set for an adapter with no separate draft tier (e.g. Notion, which has no API-level draft/publish distinction), where `writeDraftRaw` aliases straight through to the published write. The draft-lifecycle sub-test then asserts THAT contract instead of a real draft's: `hasDraft`/`readDraftRaw` report "no draft" even right after a `writeDraftRaw`, and the published read reflects the write-through immediately. |

## What each suite asserts

- **`createContentAdapterContractSuite`**: round-trips a published write/read; the draft lifecycle
  (write, read, `hasDraft`, discard), or — with `draftsWriteThrough` — that `writeDraftRaw` aliases
  through and `hasDraft`/`readDraftRaw` always report "no draft"; `exists`/`hasDraft` reporting
  independently of each other (skipped under `draftsWriteThrough`); `listSlugs` returns every
  written slug, sorted; `listLocales` includes the default locale once published there;
  `deletePublished` is idempotent (deleting twice is not an error); and that an unsafe slug or an
  unconfigured locale **rejects the promise** (not a synchronous throw).
- **`createStaticHostRoutingContractSuite`** / **`createBareUrlStaticHostRoutingContractSuite`**: a
  redirect-store hit 301s (trailing slash normalized before lookup); the directory-index/bare-URL
  rewrite is correct for ordinary paths; known metadata/passthrough paths are left untouched; a
  hostile store target (protocol-relative, backslash, control characters) is refused and falls
  through to the rewrite instead of redirecting; routing still works when the store is down
  (`storeDown: true`); a `//host/...` path is never resolved off-host; the query string is
  preserved and correctly joined (`?` or `&`) on both store redirects and canonicalization 301s;
  and an external `https://` store target passes through verbatim.
- **`createRouteContractSuite`**: every `ROUTE_CONTRACT` row is a well-formed path template; a full
  create→list→read→draft→publish→rename→duplicate→delete walk against the pages resource returns
  the documented status codes and shapes; unknown page/resource is 404; an unsupported method on a
  known resource is 405. Deliberately not exhaustive over every `ROUTE_CONTRACT` row —
  translations, collections, media and settings already have their own coverage elsewhere.
- **`createPreviewBridgeContractSuite`**: a block click posts a `select` message with the clicked
  block's index; a background click posts `index: null`; an incoming same-origin `theme` message
  is applied and a foreign-origin one is ignored; an incoming same-origin message with no
  `__typren` marker is ignored.

## Usage

Mirror how core's own adapters call this (see `packages/core/src/markdown-adapter.test.ts`,
`github-adapter.test.ts`, `notion-adapter.test.ts`):

```ts
import { createContentAdapterContractSuite } from "@typren/contract-tests";
import { createMarkdownAdapter } from "@typren/core";

describe("my adapter contract", () => {
  createContentAdapterContractSuite(() => createMarkdownAdapter({ contentDir: myTestDir }));
});
```

`makeAdapter` is called once per `it()`, so an adapter that can't be reused across tests (a fresh
temp dir, say) still works; it may return the same instance every time for one that can. An
adapter with no separate draft tier (Notion) passes the seed:

```ts
createContentAdapterContractSuite(
  () => createNotionAdapter({ client: fakeClient(), databaseId: "db-contract", /* ... */ }),
  { draftsWriteThrough: true }
);
```

For a routing adapter (see `packages/adapter-cloudflare/src/worker.test.ts`,
`packages/adapter-cloudfront/src/redirects.function.test.ts`, `packages/core/src/static-host.test.ts`):

```ts
import { createStaticHostRoutingContractSuite } from "@typren/contract-tests";

createStaticHostRoutingContractSuite("my router", async ({ path, query, redirects, storeDown }) =>
  myResolve(path, query ?? "", storeDown ? async () => { throw new Error("down"); } : async (key) => redirects?.[key] ?? null)
);
```

For the studio's HTTP API (see `packages/core/src/api/routes.contract.test.ts`):

```ts
import { createRouteContractSuite } from "@typren/contract-tests";
import { createTyprenApi } from "@typren/core";

createRouteContractSuite(() => createTyprenApi(myConfig(), { basePath: "/api/typren" }).handler, { basePath: "/api/typren" });
```

For the preview bridge (see `packages/core/src/ui/preview-bridge.contract.test.ts`):

```ts
import { createPreviewBridgeContractSuite } from "@typren/contract-tests";
import { initPreviewBridge } from "@typren/core/ui/preview-bridge.vanilla";

createPreviewBridgeContractSuite(initPreviewBridge);
```

## Errors

These suites assert, via Vitest's `expect`, rather than throwing their own errors; a failing
assertion fails the `it()` block with Vitest's own diff output. The one behavioral requirement
worth calling out: `createContentAdapterContractSuite` expects an unsafe slug/locale to produce a
**rejected promise**, not a synchronously thrown error — an adapter that throws synchronously
there fails the suite.
