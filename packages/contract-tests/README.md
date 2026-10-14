# @typren/contract-tests

Conformance suite factories for Typren's cross-repo contracts (`createTyprenApi`'s REST routes,
the preview-bridge protocol, static-host routing, and `ContentAdapter`). Core runs them against
itself; editor, cloud and every provider run them in their own CI against the core version they
install.

## Install

This package is `"private": true` — it is not published to npm. It's used from within the Typren
repo/workspace: a package in this monorepo depends on it as a `workspace:*` devDependency (see
`packages/adapter-cloudflare/package.json` or `packages/adapter-cloudfront/package.json` for the
pattern), and resolves it through the workspace rather than installing it from a registry.

## Usage

```ts
import { describe } from "vitest";
import { createContentAdapterContractSuite } from "@typren/contract-tests";
import { createMyAdapter } from "./my-adapter";

describe("createMyAdapter contract", () => {
  createContentAdapterContractSuite(() => createMyAdapter({ /* ...opts */ }));
});
```

See the [full reference](https://github.com/typren/typren/blob/develop/docs/site/reference-contract-tests.md)
for all four suites, their seed options, and a usage example per suite.

## License

SEE LICENSE IN LICENSE — this package is private (`"private": true`) and ships source directly
(no build step), used only within this repository and its CI.
