import { describe, expect, it } from "vitest";

/**
 * REST route contract for `createTyprenApi` (packages/core/src/api/routes.ts).
 * Mirrors that file's own `## Resources` doc comment, which is the contract's
 * source of truth — keep the two in sync by hand; there is no generator here,
 * on purpose (see the package README/description: this is a fixture list, not
 * a schema compiler).
 */
export interface RouteFixture {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path template. `:param` segments are path params, not literal text. */
  path: string;
  /** Top-level keys the JSON body carries. Absent for routes with no body. */
  body?: string[];
  /** Query params the route reads. */
  query?: string[];
  description: string;
}

export const ROUTE_CONTRACT: RouteFixture[] = [
  { method: "GET", path: "/pages", query: ["locale"], description: "list pages" },
  { method: "POST", path: "/pages", body: ["title", "locale"], description: "create a page -> { slug }" },
  { method: "GET", path: "/pages/:slug", query: ["locale"], description: "draft ?? published" },
  { method: "PUT", path: "/pages/:slug/draft", body: ["page", "baseVersion", "locale"], description: "save draft" },
  { method: "DELETE", path: "/pages/:slug/draft", description: "discard draft" },
  { method: "POST", path: "/pages/:slug/publish", body: ["baseVersion", "locale"], description: "publish" },
  {
    method: "POST",
    path: "/pages/:slug/rename",
    body: ["newSlug"],
    description: "rename slug -> SaveResult-shaped (409 on collision)",
  },
  { method: "POST", path: "/pages/:slug/duplicate", query: ["locale"], description: "duplicate -> { slug }" },
  { method: "DELETE", path: "/pages/:slug", description: "delete page" },
  { method: "POST", path: "/pages/:slug/translations", body: ["toLocale"], description: "create translation" },
  { method: "DELETE", path: "/pages/:slug/translations/:locale", description: "delete translation" },
  {
    method: "GET",
    path: "/collections/:id",
    query: ["locale"],
    description: "list records -> { records: CollectionRecordInfo[] }",
  },
  { method: "GET", path: "/collections/:id/:slug", query: ["locale"], description: "draft ?? published" },
  { method: "POST", path: "/collections/:id", body: ["title", "locale"], description: "create -> { slug }" },
  {
    method: "PUT",
    path: "/collections/:id/:slug/draft",
    body: ["page", "baseVersion", "locale"],
    description: "save draft",
  },
  { method: "DELETE", path: "/collections/:id/:slug/draft", description: "discard draft" },
  {
    method: "POST",
    path: "/collections/:id/:slug/publish",
    body: ["baseVersion", "locale"],
    description: "publish",
  },
  { method: "DELETE", path: "/collections/:id/:slug", description: "delete record" },
  { method: "GET", path: "/media", description: "list media" },
  { method: "POST", path: "/media", description: "upload (multipart/form-data, field \"file\")" },
  { method: "DELETE", path: "/media/:id", description: "delete media" },
  { method: "GET", path: "/settings", description: "runtime + bootstrap snapshot + version" },
  { method: "PUT", path: "/settings/draft", body: ["settings", "baseVersion", "locale"], description: "save draft" },
  { method: "POST", path: "/settings/publish", body: ["baseVersion", "locale"], description: "publish" },
  { method: "PUT", path: "/settings/bootstrap", body: ["patch"], description: "write bootstrap (admin)" },
];

/** Minimal shape createTyprenApi's handler takes: WHATWG Request in, Response out. */
export type ApiHandler = (request: Request) => Promise<Response>;

export interface RouteContractSeed {
  /** Same `basePath` the handler under test was built with, e.g. "/api/typren". */
  basePath?: string;
  baseUrl?: string;
}

/**
 * Runnable conformance suite: walks the page lifecycle end to end against a
 * live handler (create -> list -> read -> save draft -> publish -> rename ->
 * duplicate -> delete), asserting the exact status codes and response shapes
 * the table above documents, plus the two routing fallbacks (404, 405). No
 * fixture content is required beyond a working handler — the suite creates
 * and cleans up its own page — so any `createTyprenApi(config)` a consumer
 * builds can run it as-is.
 *
 * Deliberately NOT exhaustive over every row in ROUTE_CONTRACT: translations
 * need a second configured locale, collections/media/settings need their own
 * section/adapter config, and all four already have their own coverage in
 * routes.test.ts — duplicating it here on top of a made-up locale or section
 * would be a speculative fixture, not a contract check. This suite is the
 * shape that would actually break for an outside contributor with zero setup:
 * the pages resource's HTTP contract.
 */
export function createRouteContractSuite(getHandler: () => ApiHandler, seed: RouteContractSeed = {}) {
  const basePath = seed.basePath ?? "";
  const baseUrl = seed.baseUrl ?? "https://contract-tests.typren.invalid";

  const req = (method: RouteFixture["method"], path: string, body?: unknown) =>
    new Request(`${baseUrl}${basePath}${path}`, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
        : {}),
    });

  describe("REST route contract (createTyprenApi)", () => {
    it("documents every route as a well-formed path template", () => {
      for (const route of ROUTE_CONTRACT) {
        expect(route.path.startsWith("/")).toBe(true);
        expect(route.description.length).toBeGreaterThan(0);
      }
    });

    it("walks the pages lifecycle: create, list, read, draft, publish, rename, duplicate, delete", async () => {
      const handler = getHandler();

      const created = await handler(req("POST", "/pages", { title: "Contract Suite Page" }));
      expect(created.status).toBe(201);
      const { slug } = (await created.json()) as { slug: string };
      expect(typeof slug).toBe("string");

      const list = await handler(req("GET", "/pages"));
      expect(list.status).toBe(200);
      const { pages } = (await list.json()) as { pages: { slug: string }[] };
      expect(pages.some((p) => p.slug === slug)).toBe(true);

      const read = await handler(req("GET", `/pages/${slug}`));
      expect(read.status).toBe(200);
      const readBody = (await read.json()) as { page: unknown; hasDraft: boolean };
      expect(readBody).toMatchObject({ hasDraft: expect.any(Boolean) });

      const draft = await handler(req("PUT", `/pages/${slug}/draft`, { page: readBody.page }));
      expect(draft.status).toBe(200);
      const { version } = (await draft.json()) as { ok: boolean; version?: string };

      const published = await handler(req("POST", `/pages/${slug}/publish`, { baseVersion: version }));
      expect(published.status).toBe(200);

      const renamed = await handler(req("POST", `/pages/${slug}/rename`, { newSlug: `${slug}-renamed` }));
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ ok: true, slug: `${slug}-renamed` });

      const duplicated = await handler(req("POST", `/pages/${slug}-renamed/duplicate`));
      expect(duplicated.status).toBe(201);
      const { slug: copySlug } = (await duplicated.json()) as { slug: string };

      expect((await handler(req("DELETE", `/pages/${slug}-renamed`))).status).toBe(200);
      expect((await handler(req("DELETE", `/pages/${copySlug}`))).status).toBe(200);
    });

    it("answers 404 for an unknown page and an unknown resource", async () => {
      const handler = getHandler();
      expect((await handler(req("GET", "/pages/does-not-exist"))).status).toBe(404);
      expect((await handler(req("GET", "/not-a-resource"))).status).toBe(404);
    });

    it("answers 405 for a method a resource doesn't support", async () => {
      const handler = getHandler();
      expect((await handler(req("PUT", "/pages", {}))).status).toBe(405);
    });
  });
}
