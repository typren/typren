import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTyprenApi } from "./routes";
import { createTyprenClient } from "./client";
import { GIT_NO_BRANCH, GitError } from "../git";
import { createMarkdownAdapter } from "../markdown-adapter";
import { createFsMediaAdapter } from "../fs-media-adapter";
import { createFsSettingsAdapter } from "../settings";
import type { AuthAdapter, AuthContext } from "../auth-adapter";
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
    previewPath: "/studio/preview",
    // The fixture's "home" is renamed below like any page.
    homeSlug: "index",
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

  // Regression: a 500 used to echo e.message straight into the response body.
  // An adapter/filesystem error can carry absolute paths, slugs, or other
  // server internals that a public API response must never leak.
  it("never echoes the thrown error's message in a 500 response", async () => {
    const res = await api.handler(req("GET", "/media"));
    expect(res.status).toBe(500);
    const payload = await res.json();
    expect(payload.error).toBe("Internal error");
    expect(payload.error).not.toMatch(/mediaAdapter|not configured/i);
  });

  it("marks draft/published page reads private, no-store", async () => {
    const res = await api.handler(req("GET", "/pages/home"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("marks the media listing private, no-store", async () => {
    const mediaApi = createTyprenApi(
      { ...makeConfig(), mediaAdapter: createFsMediaAdapter({ dir, publicPath: "/img" }) },
      { basePath: BASE }
    );
    const res = await mediaApi.handler(req("GET", "/media"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
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
        previewPath: "/studio/preview",
        siteId: tenant,
        // Required alongside siteId: the default bootstrap adapter is one
        // process-wide file, which would collide across tenants.
        settingsAdapter: createFsSettingsAdapter({
          file: path.join(tenant === "a" ? dirA : dirB, "typren.config.json"),
        }),
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

  it("lets an allowedOrigins origin through to the upload's own origin check", async () => {
    const studioApi = createTyprenApi(
      { ...makeConfig(), mediaAdapter: createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" }) },
      { basePath: BASE, allowedOrigins: ["https://studio.test"] }
    );
    const post = () =>
      new Request(`https://example.test${BASE}/media`, {
        method: "POST",
        headers: { origin: "https://studio.test", "sec-fetch-site": "cross-site" },
        body: new FormData(),
      });
    expect((await studioApi.handler(post())).status).toBe(400);
    expect((await mediaApi.handler(post())).status).toBe(403);
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

describe("media folders and moves", () => {
  let mediaDir: string;
  let mediaApi: ReturnType<typeof createTyprenApi>;
  let client: ReturnType<typeof createTyprenClient>;
  let calls: { url: string; init?: RequestInit }[];

  beforeEach(() => {
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-media-"));
    mediaApi = createTyprenApi(
      { ...makeConfig(), mediaAdapter: createFsMediaAdapter({ dir: mediaDir, publicPath: "/img" }) },
      { basePath: BASE }
    );
    calls = [];
    client = createTyprenClient({
      baseUrl: `https://example.test${BASE}`,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return mediaApi.handler(new Request(input as string, init));
      }) as typeof globalThis.fetch,
    });
  });

  afterEach(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

  it("creates, lists, renames and deletes folders through the client", async () => {
    await client.createMediaFolder("a");
    expect(await client.listMediaFolders()).toEqual(["a"]);
    await client.renameMediaFolder("a", "b");
    expect(await client.listMediaFolders()).toEqual(["b"]);
    await client.deleteMediaFolder("b");
    expect(await client.listMediaFolders()).toEqual([]);
    expect(calls.find((c) => c.init?.method === "DELETE")?.url).toContain("/media/folders?folder=b");
  });

  it("moves an asset, rewrites page references, and reports usage", async () => {
    fs.writeFileSync(path.join(mediaDir, "p.webp"), "x");
    fs.writeFileSync(path.join(dir, "home.md"), "---\ntitle: Home\nslices: []\n---\n/img/p.webp\n");
    expect((await client.mediaUsage())["/img/p.webp"]).toEqual([{ slug: "home", locale: "en", count: 1 }]);
    const moved = await client.moveMedia("p.webp", "dir", "q");
    expect(moved.id).toBe("dir/q.webp");
    expect(fs.readFileSync(path.join(dir, "home.md"), "utf8")).toContain("/img/dir/q.webp");
  });

  it("deletes a nested asset, encoding each segment", async () => {
    fs.mkdirSync(path.join(mediaDir, "dir"));
    fs.writeFileSync(path.join(mediaDir, "dir", "p.webp"), "x");
    await client.deleteMedia("dir/p.webp");
    expect(calls.at(-1)!.url).toMatch(/\/media\/dir\/p\.webp$/);
    expect(fs.existsSync(path.join(mediaDir, "dir", "p.webp"))).toBe(false);
  });

  it("refuses deleting an asset content uses, unless forced", async () => {
    fs.writeFileSync(path.join(mediaDir, "p.webp"), "x");
    fs.writeFileSync(path.join(dir, "home.md"), "---\ntitle: Home\nslices: []\n---\n/img/p.webp\n");
    await expect(client.deleteMedia("p.webp")).rejects.toThrow('"p.webp" is used on home. Remove it there first, or delete it anyway.');
    expect(fs.existsSync(path.join(mediaDir, "p.webp"))).toBe(true);
    await client.deleteMedia("p.webp", { force: true });
    expect(calls.at(-1)!.url).toMatch(/\/media\/p\.webp\?force=1$/);
    expect(fs.existsSync(path.join(mediaDir, "p.webp"))).toBe(false);
  });

  it("sends the folder with an upload only when one is given", async () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    await client.uploadMedia(file).catch(() => {});
    await client.uploadMedia(file, "pics").catch(() => {});
    const folders = calls.filter((c) => c.init?.method === "POST").map((c) => (c.init!.body as FormData).get("folder"));
    expect(folders).toEqual([null, "pics"]);
  });

  it("405s a wrong method on /media/folders", async () => {
    expect((await mediaApi.handler(req("PATCH", "/media/folders"))).status).toBe(405);
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
    expect(await res.json()).toMatchObject({ brand: { name: "" }, bootstrap: { adminRoute: "studio" } });
  });

  it("returns only the editable bootstrap keys, never the CLI's studio block", async () => {
    fs.writeFileSync(
      path.join(dir, "typren.config.json"),
      JSON.stringify({ adminRoute: "admin", studio: { previewCommand: "npm run dev", contentDir: "content" }, review: {} })
    );
    const { bootstrap } = await (await createTyprenApi(settingsConfig(), { basePath: BASE }).handler(req("GET", "/settings"))).json();
    expect(Object.keys(bootstrap).sort()).toEqual(["adminRoute", "defaultLocale", "locales", "onboarded", "routing"]);
    expect(bootstrap.adminRoute).toBe("admin");
  });

  it("marks the settings read private, no-store", async () => {
    const res = await createTyprenApi(settingsConfig(), { basePath: BASE }).handler(req("GET", "/settings"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
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

  it("writes a valid bootstrap patch", async () => {
    const settingsApi = createTyprenApi(settingsConfig(), { basePath: BASE });
    const res = await settingsApi.handler(jsonReq("PUT", "/settings/bootstrap", { patch: { adminRoute: "backoffice" } }));
    expect(res.status).toBe(200);
    const after = await (await settingsApi.handler(req("GET", "/settings"))).json();
    expect(after.bootstrap.adminRoute).toBe("backoffice");
  });

  // Regression: PUT /settings/bootstrap used to write whatever `patch` carried
  // straight through to writeBootstrap with no validation, so any writer
  // (anyone passing the "admin" authorize() check) could install a reserved or
  // unsafe adminRoute, an inconsistent defaultLocale/locales pair, or an
  // arbitrary unrecognized key -- all of which currentAdminRoute/resolveI18n
  // assume are already well-formed by the time they're read back.
  it("rejects a bootstrap patch with an unknown key", async () => {
    const settingsApi = createTyprenApi(settingsConfig(), { basePath: BASE });
    const res = await settingsApi.handler(jsonReq("PUT", "/settings/bootstrap", { patch: { evil: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown bootstrap key/);
  });

  it("rejects a reserved adminRoute", async () => {
    const settingsApi = createTyprenApi(settingsConfig(), { basePath: BASE });
    const res = await settingsApi.handler(jsonReq("PUT", "/settings/bootstrap", { patch: { adminRoute: "api" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reserved/);
  });

  it("rejects an unsafe-shaped adminRoute", async () => {
    const settingsApi = createTyprenApi(settingsConfig(), { basePath: BASE });
    const res = await settingsApi.handler(jsonReq("PUT", "/settings/bootstrap", { patch: { adminRoute: "../etc" } }));
    expect(res.status).toBe(400);
  });

  it("rejects a locales patch that drops the current defaultLocale", async () => {
    const settingsApi = createTyprenApi(settingsConfig(), { basePath: BASE });
    const res = await settingsApi.handler(
      jsonReq("PUT", "/settings/bootstrap", { patch: { locales: ["fr", "de"] } }) // current defaultLocale is "en"
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/defaultLocale/);
  });

  it("rejects a non-BCP-47-ish locale", async () => {
    const settingsApi = createTyprenApi(settingsConfig(), { basePath: BASE });
    const res = await settingsApi.handler(
      jsonReq("PUT", "/settings/bootstrap", { patch: { locales: ["en", "../x"] } })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/locales/);
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

  it("keeps, lists and deletes page folders, refusing a folder with pages", async () => {
    const client = clientFor(api);
    expect(await client.listPageFolders()).toEqual([]);
    await client.createPageFolder("event");
    await client.createPageFolder("docs/guides");
    expect(await client.listPageFolders()).toEqual(["docs/guides", "event"]);
    await client.createPage("Day one", undefined, { slug: "event/1" });
    await expect(client.deletePageFolder("event")).rejects.toMatchObject({ status: 409 });
    await client.deletePageFolder("docs/guides");
    expect(await client.listPageFolders()).toEqual(["event"]);
    expect((await api.handler(req("POST", `${BASE}/folders`, { body: "{}" }))).status).toBe(400);
    expect((await api.handler(req("PUT", `${BASE}/folders`))).status).toBe(405);
  });

  it("creates a draft-only page at a nested slug and opens it from its draft", async () => {
    const client = clientFor(api);
    expect(await client.createPage("Day one", undefined, { slug: "event/1", draft: true })).toBe("event/1");
    expect((await client.listPages()).find((p) => p.slug === "event/1")).toMatchObject({ published: false, hasDraft: true });
    const { page, hasDraft } = await client.getPage("event/1");
    expect(hasDraft).toBe(true);
    expect(page.meta.title).toBe("Day one");
    await expect(client.getPage("event/2")).rejects.toMatchObject({ status: 404 });
  });
});

// Writes must reach authorize() with the same scope reads do: collectionId,
// locale and the target slug. A route that dropped one would let a policy
// keyed on it (a "legal" collection, a "de" team, an admin-only slug) be
// bypassed by the write while still holding for the read.
describe("AuthContext on every write route", () => {
  it("carries collectionId, locale and slug through each route", async () => {
    const legalDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-legal-"));
    const seen: AuthContext[] = [];
    const scopedApi = createTyprenApi(
      {
        ...makeConfig(),
        adapter: createMarkdownAdapter({
          contentDir: dir,
          draftDir: path.join(dir, ".drafts"),
          locales: ["en", "de"],
          defaultLocale: "en",
        }),
        sections: [
          { kind: "pages", label: "Pages" },
          { kind: "collection", id: "legal", label: "Legal", dir: legalDir, schema: {} },
        ],
        auth: {
          authorize: async (ctx) => {
            seen.push(ctx);
            return true;
          },
        },
      },
      { basePath: BASE }
    );
    const page = { page: { meta: {}, slices: [], body: "x" } };
    const call = async (r: Request) => {
      seen.length = 0;
      expect((await scopedApi.handler(r)).status).toBeLessThan(300);
      return seen.map(({ action, slug, locale, collectionId }) => ({ action, slug, locale, collectionId }));
    };
    try {
      expect(await call(jsonReq("POST", "/collections/legal?locale=de", { title: "Terms" }))).toEqual([
        { action: "createPage", slug: "terms", locale: "de", collectionId: "legal" },
      ]);
      expect(await call(jsonReq("PUT", "/collections/legal/terms/draft?locale=de", page))).toEqual([
        { action: "saveDraft", slug: "terms", locale: "de", collectionId: "legal" },
      ]);
      expect(await call(jsonReq("POST", "/collections/legal/terms/publish?locale=de", {}))).toEqual([
        { action: "publish", slug: "terms", locale: "de", collectionId: "legal" },
      ]);
      expect(await call(req("DELETE", "/collections/legal/terms/draft?locale=de"))).toEqual([
        { action: "discardDraft", slug: "terms", locale: "de", collectionId: "legal" },
      ]);
      expect(await call(req("DELETE", "/collections/legal/terms"))).toEqual([
        { action: "deletePage", slug: "terms", locale: undefined, collectionId: "legal" },
      ]);

      expect(await call(jsonReq("POST", "/pages/home/translations", { toLocale: "de" }))).toEqual([
        { action: "read", slug: "home", locale: "en", collectionId: undefined },
        { action: "saveDraft", slug: "home", locale: "de", collectionId: undefined },
      ]);
      expect(await call(jsonReq("PUT", "/pages/home/draft?locale=de", page))).toEqual([
        { action: "saveDraft", slug: "home", locale: "de", collectionId: undefined },
      ]);
      expect(await call(jsonReq("POST", "/pages/home/publish?locale=de", {}))).toEqual([
        { action: "publish", slug: "home", locale: "de", collectionId: undefined },
      ]);
      expect(await call(req("DELETE", "/pages/home/translations/de"))).toEqual([
        { action: "deletePage", slug: "home", locale: "de", collectionId: undefined },
      ]);
      expect(await call(jsonReq("POST", "/pages?locale=en", { title: "About" }))).toEqual([
        { action: "createPage", slug: "about", locale: "en", collectionId: undefined },
      ]);
      expect(await call(jsonReq("POST", "/pages/about/duplicate?locale=en", {}))).toEqual([
        { action: "read", slug: "about", locale: "en", collectionId: undefined },
        { action: "createPage", slug: "about", locale: "en", collectionId: undefined },
        { action: "createPage", slug: "about-copy", locale: "en", collectionId: undefined },
      ]);
      expect(await call(jsonReq("POST", "/pages/about/rename", { newSlug: "team" }))).toEqual([
        { action: "renamePage", slug: "about", locale: undefined, collectionId: undefined },
        { action: "renamePage", slug: "team", locale: undefined, collectionId: undefined },
      ]);
    } finally {
      fs.rmSync(legalDir, { recursive: true, force: true });
    }
  });
});

describe("git routes", () => {
  const outgoing = { branch: "main", upstream: "origin/main", commits: [{ hash: "abc", subject: "content: update home", files: [] }] };
  let pushed: { ok: true } | { ok: false; error: string };
  const pending = [{ path: "content/home.md", change: "modified" as const, commits: [{ hash: "abc", subject: "content: update home" }] }];
  const calls: unknown[] = [];
  const gitStub = {
    commit: async () => true,
    push: async () => pushed,
    pending: async () => pending,
    pushPaths: async (paths: string[]) => (calls.push(["push", paths]), pushed),
    discardPaths: async (paths: string[]) => void calls.push(["discard", paths]),
    history: async (file: string) => (calls.push(["history", file]), [{ hash: "abc", subject: "content: update home", author: "A", date: "2026-10-01T00:00:00Z" }]),
  };
  const gitApi = () =>
    createTyprenApi(
      {
        ...makeConfig(),
        git: { ...gitStub, outgoing: async () => outgoing },
      },
      { basePath: BASE }
    );

  beforeEach(() => {
    pushed = { ok: true };
  });

  it("404s without a git-backed config", async () => {
    expect((await api.handler(req("GET", "/git"))).status).toBe(404);
    expect((await api.handler(req("POST", "/git/push"))).status).toBe(404);
  });

  it("serves the outgoing commits uncached, and pushes", async () => {
    const res = await gitApi().handler(req("GET", "/git"));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual(outgoing);
    expect((await gitApi().handler(req("POST", "/git/push"))).status).toBe(200);
    expect((await gitApi().handler(req("PUT", "/git/push"))).status).toBe(404);
  });

  it("lists pending changes, and pushes or discards chosen paths", async () => {
    calls.length = 0;
    const client = createTyprenClient({ baseUrl: BASE, fetch: (u, i) => gitApi().handler(new Request(`https://example.test${u}`, i)) });
    expect(await client.gitPending()).toEqual(pending);
    await client.gitPush(["content/home.md"]);
    await client.gitDiscard(["content/home.md"]);
    await client.gitPush();
    expect(calls).toEqual([
      ["push", ["content/home.md"]],
      ["discard", ["content/home.md"]],
    ]);
    calls.length = 0;
    expect((await client.gitHistory("home"))[0]!.hash).toBe("abc");
    expect(calls).toEqual([["history", expect.stringMatching(/home\.md$/)]]);
    const post = (p: string, b: unknown) => gitApi().handler(jsonReq("POST", p, b));
    expect((await post("/git/discard", {})).status).toBe(400);
    expect((await post("/git/push", { paths: [1] })).status).toBe(400);
    pushed = { ok: false, error: "Someone pushed first." };
    expect((await post("/git/push", { paths: ["content/home.md"] })).status).toBe(502);
  });

  it("serves a page's history, refusing anything that is not a page", async () => {
    calls.length = 0;
    const client = createTyprenClient({ baseUrl: BASE, fetch: (u, i) => gitApi().handler(new Request(`https://example.test${u}`, i)) });
    expect(await client.gitHistory("home")).toEqual([expect.objectContaining({ hash: "abc" })]);
    expect(calls).toEqual([["history", path.join(dir, "home.md")]]);
    const get = (q: string) => gitApi().handler(req("GET", `/git/history${q}`));
    expect((await get("")).status).toBe(400);
    for (const bad of ["?slug=..%2F..%2Fetc%2Fpasswd", "?slug=%2Fabs", "?slug=home&locale=..%2Fx"]) expect((await get(bad)).status, bad).toBe(400);
    const outside = createTyprenApi(
      { ...makeConfig(), git: { ...gitStub, outgoing: async () => outgoing, history: async () => Promise.reject(new GitError("no")) } },
      { basePath: BASE }
    );
    expect((await outside.handler(req("GET", "/git/history?slug=home"))).status).toBe(400);
  });

  it("pushes chosen pages' drafts with chosen paths", async () => {
    calls.length = 0;
    const res = await gitApi().handler(jsonReq("POST", "/git/push", { slugs: ["nope"] }));
    expect(res.status).toBe(200);
    // Drafts alone send an empty path list.
    expect((await gitApi().handler(jsonReq("POST", "/git/push", { paths: [], slugs: ["nope"] }))).status).toBe(200);
    expect((await gitApi().handler(jsonReq("POST", "/git/push", { slugs: [2] }))).status).toBe(400);
  });

  it("publishes the settings draft on a push with settings, and serves, discards and dates it", async () => {
    calls.length = 0;
    const api = gitApi();
    const client = createTyprenClient({ baseUrl: BASE, fetch: (u, i) => api.handler(new Request(`https://example.test${u}`, i)) });
    await client.saveSettingsDraft({ brand: { name: "Acme" }, seo: {} });
    expect(await client.getSettings()).toMatchObject({ brand: { name: "Acme" }, hasDraft: true });
    await client.gitPush([], [], true);
    expect(await client.getSettings()).toMatchObject({ brand: { name: "Acme" }, hasDraft: false });
    await client.saveSettingsDraft({ brand: { name: "Acme 2" }, seo: {} });
    await client.discardSettingsDraft();
    expect(await client.getSettings()).toMatchObject({ brand: { name: "Acme" }, hasDraft: false });
    expect(await client.settingsHistory()).toEqual([expect.objectContaining({ hash: "abc" })]);
    expect(calls.at(-1)).toEqual(["history", expect.stringMatching(/settings\.md$/)]);
  });

  it("returns a rejected push's error text as a 502", async () => {
    pushed = { ok: false, error: "! [rejected] main -> main (fetch first)" };
    const res = await gitApi().handler(req("POST", "/git/push"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/rejected/);
  });

  it("answers a git failure on publish with its plain-language reason as a 422", async () => {
    fs.mkdirSync(path.join(dir, ".drafts"));
    fs.writeFileSync(path.join(dir, ".drafts", "home.md"), "---\ntitle: Draft\nslices: []\n---\n");
    const failing = createTyprenApi(
      {
        ...makeConfig(),
        git: { ...gitStub, outgoing: async () => outgoing },
        onPublish: () => {
          throw new GitError("A check in your repository stopped the commit: nope");
        },
      },
      { basePath: BASE }
    );
    const res = await failing.handler(req("POST", "/pages/home/publish"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("A check in your repository stopped the commit: nope");
  });

  it("refuses a git-backed publish on a detached HEAD without touching the page", async () => {
    fs.mkdirSync(path.join(dir, ".drafts"));
    fs.writeFileSync(path.join(dir, ".drafts", "home.md"), "---\ntitle: Draft\nslices: []\n---\n");
    const detached = createTyprenApi(
      {
        ...makeConfig(),
        git: { ...gitStub, outgoing: async () => ({ ...outgoing, branch: "" }) },
        onPublish: () => {},
      },
      { basePath: BASE }
    );
    const res = await detached.handler(req("POST", "/pages/home/publish"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(GIT_NO_BRANCH);
    expect(fs.existsSync(path.join(dir, ".drafts", "home.md"))).toBe(true);
  });

  it("gates both on auth", async () => {
    allow = false;
    expect((await gitApi().handler(req("GET", "/git"))).status).toBe(403);
    expect((await gitApi().handler(req("POST", "/git/push"))).status).toBe(403);
  });
});

describe("page flows", () => {
  const client = () => createTyprenClient({ baseUrl: BASE, fetch: (u, i) => api.handler(new Request(`https://example.test${u}`, i)) });
  const draftOf = (slug: string) => fs.readFileSync(path.join(dir, ".drafts", `${slug}.md`), "utf8");

  it("creates a draft page holding sections, and 400s without a slug", async () => {
    const c = client();
    expect(await c.createPageFrom("Pricing", "pricing", [{ slice: "hero" }])).toBe("pricing");
    expect(draftOf("pricing")).toContain("hero");
    const bare = await api.handler(jsonReq("POST", "/pages", { title: "X", slices: [] }));
    expect(bare.status).toBe(400);
  });

  it("inserts a section, refuses a stale one with 409, and 400s without a slice", async () => {
    const c = client();
    const first = await c.insertSection("home", { slice: "a" }, "end");
    expect(first.ok).toBe(true);
    const stale = await c.insertSection("home", { slice: "b" }, 0, "nope");
    expect(stale).toMatchObject({ ok: false, code: "conflict" });
    expect((await api.handler(jsonReq("POST", "/pages/home/sections", {}))).status).toBe(400);
    expect((await api.handler(jsonReq("POST", "/pages/home/sections", { slice: { slice: "c" } }))).status).toBe(200);
  });

  it("updates page meta, and 400s without a patch", async () => {
    const c = client();
    expect((await c.updatePageMeta("home", { title: "Start", noindex: true })).ok).toBe(true);
    expect(draftOf("home")).toMatch(/title: Start/);
    expect(await c.updatePageMeta("home", { title: "Other" }, "nope")).toMatchObject({ ok: false, code: "conflict" });
    expect((await api.handler(jsonReq("PUT", "/pages/home/meta", {}))).status).toBe(400);
  });

  it("commits a page, with or without edits", async () => {
    const c = client();
    const res = await c.commitPage("home", { meta: { title: "Committed" }, slices: [], body: "" });
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, "home.md"), "utf8")).toContain("Committed");
    await c.saveDraft("home", { meta: { title: "Again" }, slices: [], body: "" });
    expect(await c.commitPage("home", undefined, "nope")).toMatchObject({ ok: false, code: "conflict" });
  });

  it("publishes every draft", async () => {
    const c = client();
    await c.createPageFrom("One", "one", []);
    await c.createPageFrom("Two", "two", []);
    expect((await c.publishAll()).sort()).toEqual(["one", "two"]);
    expect(await c.publishAll()).toEqual([]);
  });

  it("answers a locked rename as a 422 with a plain reason, which the client throws", async () => {
    const home = createTyprenApi({ ...makeConfig(), homeSlug: "home" }, { basePath: BASE });
    const res = await home.handler(jsonReq("POST", "/pages/home/rename", { newSlug: "start" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("The home page keeps its slug.");
    const c = createTyprenClient({ baseUrl: BASE, fetch: (u, i) => home.handler(new Request(`https://example.test${u}`, i)) });
    await expect(c.renamePage("home", "start")).rejects.toThrow("The home page keeps its slug.");
  });
});
