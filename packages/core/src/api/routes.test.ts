import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTyprenApi } from "./routes";
import { createTyprenClient } from "./client";
import { createMarkdownAdapter } from "../markdown-adapter";
import { createFsMediaAdapter } from "../fs-media-adapter";
import { createFsSettingsAdapter } from "../settings";
import type { AuthAdapter } from "../auth-adapter";
import type { CmsConfig } from "../types";

let dir: string;
let allow: boolean;

const BASE = "/api/typren";
const openAuth = (): AuthAdapter => ({
  getUser: async () => ({ id: "test" }),
  authorize: async () => allow,
});

function makeConfig(): CmsConfig {
  return {
    registry: {},
    defaults: {},
    adapter: createMarkdownAdapter({ contentDir: dir, draftDir: path.join(dir, ".drafts") }),
    previewPath: "/editor/preview",
    auth: openAuth(),
  };
}

let api: ReturnType<typeof createTyprenApi>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-api-"));
  fs.writeFileSync(path.join(dir, "home.md"), "---\ntitle: Home\nslices: []\n---\n");
  allow = true;
  api = createTyprenApi(makeConfig(), { basePath: BASE });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const req = (method: string, url: string, init: RequestInit = {}) =>
  new Request(`https://example.test${BASE}${url}`, { method, ...init });

const jsonReq = (method: string, url: string, payload: unknown) =>
  req(method, url, { body: JSON.stringify(payload), headers: { "content-type": "application/json" } });

describe("typren HTTP API", () => {
  it("lists and reads pages", async () => {
    const list = await api.handler(req("GET", "/pages"));
    expect(list.status).toBe(200);
    expect((await list.json()).pages.map((p: { slug: string }) => p.slug)).toContain("home");

    const one = await api.handler(req("GET", "/pages/home"));
    expect(one.status).toBe(200);
    const body = await one.json();
    expect(body.page.meta.title).toBe("Home");
  });

  it("404s an unknown page and an unknown resource", async () => {
    expect((await api.handler(req("GET", "/pages/nope"))).status).toBe(404);
    expect((await api.handler(req("GET", "/nonsense"))).status).toBe(404);
  });

  it("saves a draft then publishes it", async () => {
    const saved = await api.handler(
      jsonReq("PUT", "/pages/home/draft", { page: { meta: { title: "Home" }, slices: [], body: "changed" } })
    );
    expect(saved.status).toBe(200);
    const { version } = await saved.json();
    expect(fs.existsSync(path.join(dir, ".drafts", "home.md"))).toBe(true);

    const published = await api.handler(jsonReq("POST", "/pages/home/publish", { baseVersion: version }));
    expect(published.status).toBe(200);
    expect(fs.readFileSync(path.join(dir, "home.md"), "utf8")).toContain("changed");
  });

  // Optimistic locking is a normal outcome, not an error: the status has to be
  // distinguishable (409) while the body stays the SaveResult the UI branches on.
  it("returns 409 with the SaveResult body on a version conflict", async () => {
    const stale = await api.handler(
      jsonReq("PUT", "/pages/home/draft", {
        page: { meta: { title: "Home" }, slices: [], body: "x" },
        baseVersion: "definitely-not-current",
      })
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, code: "conflict" });
  });

  it("creates and deletes a page", async () => {
    const created = await api.handler(jsonReq("POST", "/pages", { title: "About Us" }));
    expect(created.status).toBe(201);
    expect((await created.json()).slug).toBe("about-us");

    expect((await api.handler(req("DELETE", "/pages/about-us"))).status).toBe(200);
    expect(fs.existsSync(path.join(dir, "about-us.md"))).toBe(false);
  });

  it("rejects a create with no title, and an unsupported method", async () => {
    expect((await api.handler(jsonReq("POST", "/pages", {}))).status).toBe(400);
    expect((await api.handler(req("PATCH", "/pages"))).status).toBe(405);
  });

  it("maps a denied authorize() to 403 on both reads and writes", async () => {
    allow = false;
    expect((await api.handler(req("GET", "/pages"))).status).toBe(403);
    const write = await api.handler(
      jsonReq("PUT", "/pages/home/draft", { page: { meta: {}, slices: [], body: "" } })
    );
    expect(write.status).toBe(403);
  });

  // Server Actions gave origin checking for free; an HTTP endpoint has to do it
  // or a cookie-authenticated editor is CSRF-able.
  it("refuses a cross-origin write but allows a cross-origin read", async () => {
    const write = await api.handler(
      req("PUT", "/pages/home/draft", { headers: { origin: "https://evil.test" }, body: "{}" })
    );
    expect(write.status).toBe(403);
    expect((await write.json()).error).toMatch(/cross-origin/i);

    const read = await api.handler(req("GET", "/pages", { headers: { origin: "https://evil.test" } }));
    expect(read.status).toBe(200);
  });

  it("allows a same-origin write and an explicitly allowed foreign origin", async () => {
    const same = await api.handler(
      jsonReq("PUT", "/pages/home/draft", { page: { meta: {}, slices: [], body: "ok" } })
    );
    expect(same.status).toBe(200);

    const split = createTyprenApi(makeConfig(), { basePath: BASE, allowedOrigins: ["https://studio.test"] });
    const allowed = await split.handler(
      new Request(`https://example.test${BASE}/pages/home/draft`, {
        method: "PUT",
        headers: { origin: "https://studio.test", "content-type": "application/json" },
        body: JSON.stringify({ page: { meta: {}, slices: [], body: "ok" } }),
      })
    );
    expect(allowed.status).toBe(200);
  });

  it("404s media when no adapter is configured", async () => {
    expect((await api.handler(req("GET", "/media"))).status).toBe(500); // listMedia throws: not configured
  });
});

// The hosted model needs siteId/accountId on every AuthContext the package
// builds so a hosted authorize() can enforce tenant isolation structurally
// (docs/hosted-platform.md, "Tenant isolation"). This checks the plumbing
// end to end through the HTTP layer: reads, content writes, and the admin
// (bootstrap) path all reach authorize() with the config's tenant scope.
describe("tenant scope (siteId/accountId)", () => {
  it("threads config.siteId/accountId into every authorize() call", async () => {
    const seen: Array<{ action: string; siteId?: string; accountId?: string }> = [];
    const scoped: CmsConfig = {
      ...makeConfig(),
      siteId: "site_1",
      accountId: "acct_1",
      settingsAdapter: createFsSettingsAdapter({ file: path.join(dir, "typren.config.json") }),
      auth: {
        authorize: async (ctx) => {
          seen.push({ action: ctx.action, siteId: ctx.siteId, accountId: ctx.accountId });
          return true;
        },
      },
    };
    const scopedApi = createTyprenApi(scoped, { basePath: BASE });

    await scopedApi.handler(req("GET", "/pages"));
    await scopedApi.handler(
      jsonReq("PUT", "/pages/home/draft", { page: { meta: {}, slices: [], body: "x" } })
    );
    await scopedApi.handler(jsonReq("PUT", "/settings/bootstrap", { patch: { onboarded: true } }));

    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const ctx of seen) expect(ctx).toMatchObject({ siteId: "site_1", accountId: "acct_1" });
  });

  it("leaves siteId/accountId undefined for a single-site config (back-compat)", async () => {
    const seen: Array<{ siteId?: string; accountId?: string }> = [];
    const single: CmsConfig = {
      ...makeConfig(),
      auth: {
        authorize: async (ctx) => {
          seen.push({ siteId: ctx.siteId, accountId: ctx.accountId });
          return true;
        },
      },
    };
    await createTyprenApi(single, { basePath: BASE }).handler(req("GET", "/pages"));
    expect(seen).toEqual([{ siteId: undefined, accountId: undefined }]);
  });
});

// Item 3: createTyprenApi(config) built everything once at construction --
// one process, one tenant. A hosted host needs a fresh config resolved per
// request instead, without losing the plain-config call signature.
describe("config factory (per-request resolution)", () => {
  it("calls the factory again on every request instead of once at construction", async () => {
    let calls = 0;
    const factoryApi = createTyprenApi(() => {
      calls++;
      return makeConfig();
    }, { basePath: BASE });

    expect(calls).toBe(0); // not resolved at construction time

    await factoryApi.handler(req("GET", "/pages"));
    await factoryApi.handler(req("GET", "/pages"));
    expect(calls).toBe(2);
  });

  it("isolates concurrent requests for different tenants (no shared/reassigned state)", async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "typren-tenant-a-"));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "typren-tenant-b-"));
    try {
      fs.writeFileSync(path.join(dirA, "home.md"), "---\ntitle: Tenant A\nslices: []\n---\n");
      fs.writeFileSync(path.join(dirB, "home.md"), "---\ntitle: Tenant B\nslices: []\n---\n");

      const configFor = (tenant: "a" | "b"): CmsConfig => ({
        registry: {},
        defaults: {},
        adapter: createMarkdownAdapter({ contentDir: tenant === "a" ? dirA : dirB }),
        previewPath: "/editor/preview",
        siteId: tenant,
        auth: openAuth(),
      });

      const factoryApi = createTyprenApi(
        (request) => configFor(request.headers.get("x-tenant") === "b" ? "b" : "a"),
        { basePath: BASE }
      );
      const reqFor = (tenant: "a" | "b") => req("GET", "/pages", { headers: { "x-tenant": tenant } });

      // Fire both concurrently: if per-request state ever leaked through a
      // shared/reassigned closure variable, one of these could observe the
      // OTHER tenant's adapter mid-flight.
      const [resA, resB] = await Promise.all([factoryApi.handler(reqFor("a")), factoryApi.handler(reqFor("b"))]);
      const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

      expect(bodyA.pages[0].title).toBe("Tenant A");
      expect(bodyB.pages[0].title).toBe("Tenant B");
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
});

describe("rename", () => {
  it("moves both the published file and any draft to the new slug", async () => {
    await api.handler(
      jsonReq("PUT", "/pages/home/draft", { page: { meta: { title: "Home" }, slices: [], body: "wip" } })
    );
    expect(fs.existsSync(path.join(dir, ".drafts", "home.md"))).toBe(true);

    const res = await api.handler(jsonReq("POST", "/pages/home/rename", { newSlug: "homepage" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, slug: "homepage" });

    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".drafts", "home.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "homepage.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".drafts", "homepage.md"), "utf8")).toContain("wip");
  });

  // "Refuse rather than clobber": landing on a slug that already has content
  // must not silently overwrite it.
  it("refuses (409) a rename onto an existing slug rather than clobbering it", async () => {
    await api.handler(jsonReq("POST", "/pages", { title: "About" })); // -> about.md
    const res = await api.handler(jsonReq("POST", "/pages/home/rename", { newSlug: "about" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "conflict" });
    // both sides untouched
    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "about.md"))).toBe(true);
  });

  it("is locale-aware: moves the published file and draft for every locale the page occupies", async () => {
    const esDir = path.join(dir, "es");
    fs.mkdirSync(path.join(esDir, ".drafts"), { recursive: true });
    fs.writeFileSync(path.join(esDir, "home.md"), "---\ntitle: Casa\nslices: []\n---\n");
    fs.writeFileSync(path.join(esDir, ".drafts", "home.md"), "---\ntitle: Casa borrador\nslices: []\n---\n");

    const i18nApi = createTyprenApi(
      { ...makeConfig(), adapter: createMarkdownAdapter({ contentDir: dir, locales: ["en", "es"], defaultLocale: "en" }) },
      { basePath: BASE }
    );

    const res = await i18nApi.handler(jsonReq("POST", "/pages/home/rename", { newSlug: "homepage" }));
    expect(res.status).toBe(200);

    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "homepage.md"))).toBe(true);
    expect(fs.existsSync(path.join(esDir, "home.md"))).toBe(false);
    expect(fs.existsSync(path.join(esDir, "homepage.md"))).toBe(true);
    expect(fs.existsSync(path.join(esDir, ".drafts", "home.md"))).toBe(false);
    expect(fs.existsSync(path.join(esDir, ".drafts", "homepage.md"))).toBe(true);
  });

  it("gates rename behind authorize()", async () => {
    allow = false;
    const res = await api.handler(jsonReq("POST", "/pages/home/rename", { newSlug: "homepage" }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(dir, "home.md"))).toBe(true); // untouched
  });
});

describe("duplicate", () => {
  it("copies to a non-colliding slug derived from the source", async () => {
    await api.handler(jsonReq("POST", "/pages", { title: "About" })); // -> about.md
    const res = await api.handler(req("POST", "/pages/about/duplicate"));
    expect(res.status).toBe(201);
    const { slug } = await res.json();
    expect(slug).toBe("about-copy");
    expect(fs.existsSync(path.join(dir, "about-copy.md"))).toBe(true);
  });

  it("duplicating twice produces two distinct slugs", async () => {
    await api.handler(jsonReq("POST", "/pages", { title: "About" }));
    const first = await (await api.handler(req("POST", "/pages/about/duplicate"))).json();
    const second = await (await api.handler(req("POST", "/pages/about/duplicate"))).json();
    expect(first.slug).toBe("about-copy");
    expect(second.slug).toBe("about-copy-2");
    expect(first.slug).not.toBe(second.slug);
  });

  it("gates duplicate behind authorize()", async () => {
    await api.handler(jsonReq("POST", "/pages", { title: "About" }));
    allow = false;
    const res = await api.handler(req("POST", "/pages/about/duplicate"));
    expect(res.status).toBe(403);
  });
});

describe("secondary write paths and method-not-allowed", () => {
  it("405s an unsupported method on a page and on its draft sub-resource", async () => {
    expect((await api.handler(req("PATCH", "/pages/home"))).status).toBe(405);
    expect((await api.handler(req("PATCH", "/pages/home/draft"))).status).toBe(405);
  });

  it("discards a draft via DELETE", async () => {
    await api.handler(jsonReq("PUT", "/pages/home/draft", { page: { meta: {}, slices: [], body: "wip" } }));
    expect(fs.existsSync(path.join(dir, ".drafts", "home.md"))).toBe(true);
    expect((await api.handler(req("DELETE", "/pages/home/draft"))).status).toBe(200);
    expect(fs.existsSync(path.join(dir, ".drafts", "home.md"))).toBe(false);
  });

  it("creates and deletes a translation", async () => {
    const i18nApi = createTyprenApi(
      { ...makeConfig(), adapter: createMarkdownAdapter({ contentDir: dir, locales: ["en", "es"], defaultLocale: "en" }) },
      { basePath: BASE }
    );

    const created = await i18nApi.handler(jsonReq("POST", "/pages/home/translations", { toLocale: "es" }));
    expect(created.status).toBe(201);
    expect(fs.existsSync(path.join(dir, "es", ".drafts", "home.md"))).toBe(true);

    const rejected = await i18nApi.handler(jsonReq("POST", "/pages/home/translations", {}));
    expect(rejected.status).toBe(400);

    const deleted = await i18nApi.handler(req("DELETE", "/pages/home/translations/es"));
    expect(deleted.status).toBe(200);
    expect(fs.existsSync(path.join(dir, "es", ".drafts", "home.md"))).toBe(false);
  });

  it("404s an unmatched pages sub-route", async () => {
    expect((await api.handler(req("GET", "/pages/home/nonsense"))).status).toBe(404);
  });
});

describe("media resource", () => {
  let mediaDir: string;
  let mediaApi: ReturnType<typeof createTyprenApi>;

  beforeEach(() => {
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-media-"));
    mediaApi = createTyprenApi(
      { ...makeConfig(), mediaAdapter: createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" }) },
      { basePath: BASE }
    );
  });

  afterEach(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

  // A real binary multipart round-trip (constructing `File`/`FormData` and
  // reading them back via `Request.formData()`) is exercised end to end by
  // `media.test.ts`'s `processUpload` suite; jsdom's own FormData/File
  // implementation isn't reliably interchangeable with Node's in this
  // environment, so this level sticks to the dispatch/auth/adapter wiring.
  it("routes a POST with no file to handleMediaUpload, which rejects it", async () => {
    const form = new FormData();
    form.set("notes", "no file field here");
    const res = await mediaApi.handler(
      new Request(`https://example.test${BASE}/media`, { method: "POST", body: form })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/no file/i) });
  });

  it("lists and deletes a media asset (delete is idempotent)", async () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "photo.webp"), "fake-webp-bytes");

    const list = await mediaApi.handler(req("GET", "/media"));
    expect((await list.json()).media).toHaveLength(1);

    const deleted = await mediaApi.handler(req("DELETE", "/media/photo.webp"));
    expect(deleted.status).toBe(200);
    expect((await (await mediaApi.handler(req("GET", "/media"))).json()).media).toHaveLength(0);

    // Deleting an already-gone id is still a 200 (the adapter's own idempotent delete).
    expect((await mediaApi.handler(req("DELETE", "/media/photo.webp"))).status).toBe(200);
  });

  it("405s an unsupported method on the media root and on an item", async () => {
    expect((await mediaApi.handler(req("PATCH", "/media"))).status).toBe(405);
    expect((await mediaApi.handler(req("PATCH", "/media/foo.webp"))).status).toBe(405);
  });
});

describe("settings resource", () => {
  // Runtime settings persist next to the adapter's content root (a `.typren`
  // sibling dir, see settings.ts), so a dedicated nested content dir keeps
  // that sibling INSIDE this test's own tmpdir instead of leaking into
  // `os.tmpdir()/.typren`, shared (and never cleaned up) across every test.
  const settingsConfig = (): CmsConfig => {
    const contentDir = path.join(dir, "settings-content");
    fs.mkdirSync(contentDir, { recursive: true });
    return {
      ...makeConfig(),
      adapter: createMarkdownAdapter({ contentDir }),
      settingsAdapter: createFsSettingsAdapter({ file: path.join(dir, "typren.config.json") }),
    };
  };

  it("reads runtime + bootstrap + version, defaulting to empty runtime settings", async () => {
    const res = await createTyprenApi(settingsConfig(), { basePath: BASE }).handler(req("GET", "/settings"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ brand: { name: "" }, bootstrap: { adminRoute: "editor" } });
  });

  it("saves a settings draft then publishes it", async () => {
    const settingsApi = createTyprenApi(settingsConfig(), { basePath: BASE });
    const saved = await settingsApi.handler(
      jsonReq("PUT", "/settings/draft", { settings: { brand: { name: "Acme" }, seo: {} } })
    );
    expect(saved.status).toBe(200);
    const { version } = await saved.json();

    const published = await settingsApi.handler(jsonReq("POST", "/settings/publish", { baseVersion: version }));
    expect(published.status).toBe(200);

    const after = await (await settingsApi.handler(req("GET", "/settings"))).json();
    expect(after.brand.name).toBe("Acme");
  });

  it("gates bootstrap writes behind the admin action", async () => {
    allow = false;
    const res = await createTyprenApi(settingsConfig(), { basePath: BASE }).handler(
      jsonReq("PUT", "/settings/bootstrap", { patch: { onboarded: true } })
    );
    expect(res.status).toBe(403);
  });

  it("404s an unmatched settings sub-route", async () => {
    const res = await createTyprenApi(settingsConfig(), { basePath: BASE }).handler(req("GET", "/settings/nonsense"));
    expect(res.status).toBe(404);
  });
});

describe("collections resource", () => {
  let authorsDir: string;
  let collectionsApi: ReturnType<typeof createTyprenApi>;

  function makeCollectionsConfig(): CmsConfig {
    return {
      ...makeConfig(),
      sections: [
        { kind: "pages", label: "Pages" },
        { kind: "collection", id: "authors", label: "Authors", dir: authorsDir, schema: { name: { type: "text" } } },
      ],
    };
  }

  beforeEach(() => {
    // Sibling of `dir` (the Pages content dir) so the overlap guard doesn't fire.
    authorsDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-authors-"));
    collectionsApi = createTyprenApi(makeCollectionsConfig(), { basePath: BASE });
  });

  afterEach(() => {
    fs.rmSync(authorsDir, { recursive: true, force: true });
  });

  it("lists, creates, saves a draft, publishes, reads and deletes a record", async () => {
    const created = await collectionsApi.handler(jsonReq("POST", "/collections/authors", { title: "Gabriel Lam" }));
    expect(created.status).toBe(201);
    const { slug } = await created.json();
    expect(slug).toBe("gabriel-lam");

    const saved = await collectionsApi.handler(
      jsonReq("PUT", `/collections/authors/${slug}/draft`, {
        page: { meta: { name: "Gabriel Lam" }, slices: [], body: "Bio." },
      })
    );
    expect(saved.status).toBe(200);
    const { version } = await saved.json();

    const published = await collectionsApi.handler(
      jsonReq("POST", `/collections/authors/${slug}/publish`, { baseVersion: version })
    );
    expect(published.status).toBe(200);

    const list = await collectionsApi.handler(req("GET", "/collections/authors"));
    expect(list.status).toBe(200);
    const { records } = await list.json();
    expect(records).toEqual([{ slug, meta: { name: "Gabriel Lam" }, body: "Bio.\n", hasDraft: false }]);

    const one = await collectionsApi.handler(req("GET", `/collections/authors/${slug}`));
    expect(one.status).toBe(200);
    const oneBody = await one.json();
    expect(oneBody).toMatchObject({ hasDraft: false });
    expect(oneBody.page.meta.name).toBe("Gabriel Lam");

    const deleted = await collectionsApi.handler(req("DELETE", `/collections/authors/${slug}`));
    expect(deleted.status).toBe(200);
    expect((await collectionsApi.handler(req("GET", `/collections/authors/${slug}`))).status).toBe(404);
  });

  it("discards a draft", async () => {
    const { slug } = await (
      await collectionsApi.handler(jsonReq("POST", "/collections/authors", { title: "Ada" }))
    ).json();
    await collectionsApi.handler(
      jsonReq("PUT", `/collections/authors/${slug}/draft`, { page: { meta: { name: "Ada" }, slices: [], body: "x" } })
    );
    expect((await collectionsApi.handler(req("DELETE", `/collections/authors/${slug}/draft`))).status).toBe(200);
    const one = await (await collectionsApi.handler(req("GET", `/collections/authors/${slug}`))).json();
    expect(one.hasDraft).toBe(false);
  });

  it("404s an unknown collection id, and a resolved id that isn't a collection", async () => {
    expect((await collectionsApi.handler(req("GET", "/collections/nope"))).status).toBe(404);
    // "pages" is a real resolved section id here (kind: "pages"), not a collection.
    expect((await collectionsApi.handler(req("GET", "/collections/pages"))).status).toBe(404);
  });

  it("405s an unsupported method on the collection root and its draft sub-resource", async () => {
    expect((await collectionsApi.handler(req("PATCH", "/collections/authors"))).status).toBe(405);
    const { slug } = await (
      await collectionsApi.handler(jsonReq("POST", "/collections/authors", { title: "Ada" }))
    ).json();
    expect((await collectionsApi.handler(req("PATCH", `/collections/authors/${slug}/draft`))).status).toBe(405);
  });

  it("404s an unmatched record sub-route", async () => {
    const { slug } = await (
      await collectionsApi.handler(jsonReq("POST", "/collections/authors", { title: "Ada" }))
    ).json();
    expect((await collectionsApi.handler(req("GET", `/collections/authors/${slug}/nonsense`))).status).toBe(404);
  });

  it("refuses a cross-origin write", async () => {
    const write = await collectionsApi.handler(
      req("PUT", "/collections/authors/gabriel-lam/draft", { headers: { origin: "https://evil.test" }, body: "{}" })
    );
    expect(write.status).toBe(403);
  });

  // segments() locates the resource by finding the first path segment that's a
  // known resource name. A record slug that happens to equal one ("pages"
  // here) must not get mistaken for the /pages resource, since "collections"
  // itself is always the leftmost match in this path.
  it("is not confused by a record slug equal to a resource name", async () => {
    await collectionsApi.handler(jsonReq("POST", "/collections/authors", { title: "Pages" })); // slug: "pages"
    const one = await collectionsApi.handler(req("GET", "/collections/authors/pages"));
    expect(one.status).toBe(200);
    expect((await one.json()).page.meta.title).toBe("Pages");
  });

  it("drives the same routes through createTyprenClient's collection(id) + listCollectionRecords", async () => {
    const client = createTyprenClient({
      baseUrl: `https://example.test${BASE}`,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        collectionsApi.handler(new Request(input as string, init))) as typeof globalThis.fetch,
    });

    const authors = client.collection("authors");
    const slug = await authors.createPage("Gabriel Lam");
    const result = await authors.saveDraft(slug, { meta: { name: "Gabriel Lam" }, slices: [], body: "Bio." });
    expect(result.ok).toBe(true);
    await authors.publish(slug);

    const { page, hasDraft } = await authors.getRecord(slug);
    expect(hasDraft).toBe(false);
    expect(page.body).toContain("Bio.");

    const records = await client.listCollectionRecords("authors");
    expect(records).toEqual([{ slug, meta: { name: "Gabriel Lam" }, body: "Bio.\n", hasDraft: false }]);

    await authors.deletePage(slug);
    expect(await client.listCollectionRecords("authors")).toEqual([]);
  });
});

describe("createTyprenClient over the handler", () => {
  /** Wires the client straight to the handler: no network, but the full
   *  serialize → route → deserialize path, which is what would actually break. */
  const clientFor = (a: ReturnType<typeof createTyprenApi>) =>
    createTyprenClient({
      baseUrl: `https://example.test${BASE}`,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        a.handler(new Request(input as string, init))) as typeof globalThis.fetch,
    });

  it("round-trips a draft save through the same object shape the UI uses", async () => {
    const client = clientFor(api);
    const pages = await client.listPages();
    expect(pages.map((p) => p.slug)).toContain("home");

    const result = await client.saveDraft("home", { meta: { title: "Home" }, slices: [], body: "via client" });
    expect(result.ok).toBe(true);

    const { page, hasDraft } = await client.getPage("home");
    expect(hasDraft).toBe(true);
    expect(page.body).toContain("via client");
  });

  it("surfaces a conflict as a SaveResult rather than throwing", async () => {
    const client = clientFor(api);
    const result = await client.saveDraft(
      "home",
      { meta: {}, slices: [], body: "x" },
      "stale-version"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
  });

  it("throws TyprenApiError with the status when the server refuses", async () => {
    allow = false;
    const client = clientFor(api);
    await expect(client.listPages()).rejects.toMatchObject({ name: "TyprenApiError", status: 403 });
  });

  it("creates a page and returns the normalized slug", async () => {
    const client = clientFor(api);
    expect(await client.createPage("Hello World")).toBe("hello-world");
  });
});
