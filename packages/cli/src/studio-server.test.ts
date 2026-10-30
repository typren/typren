// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StudioManifest } from "@typren/core";
import { createTyprenClient } from "@typren/core/api/client";
import { createTyprenApi } from "@typren/core/api";
import { studioSiteConfig } from "@typren/core";
import { serveOnLoopback, studioApi } from "./studio-server";

const CLOUD = "https://app.typren.test";
const TOKEN = "k".repeat(43);
let dir: string;
let manifest: StudioManifest;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-studio-api-"));
  const contentDir = path.join(dir, "content");
  fs.mkdirSync(contentDir);
  fs.writeFileSync(path.join(contentDir, "home.md"), "---\ntitle: Home\nslices: []\n---\n");
  manifest = { siteDir: dir, contentDir, siteUrl: "http://127.0.0.1:1", defaults: { hero: {} } };
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// A 1x1 PNG, so the upload passes the real image checks.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const png = () => new File([Buffer.from(PNG, "base64")], "a.png", { type: "image/png" });

const call = (handler: (r: Request) => Promise<Response>, url: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  handler(new Request(`http://127.0.0.1:4400/api/typren${url}`, { ...init, headers }));

describe("studioApi", () => {
  it("serves the paired origin with the token: pages, the studio bootstrap and writes", async () => {
    const api = studioApi(manifest, { origin: CLOUD, token: TOKEN });
    const auth = { origin: CLOUD, authorization: `Bearer ${TOKEN}` };
    const boot = await call(api, "/studio", auth);
    expect(boot.status).toBe(200);
    expect(await boot.json()).toMatchObject({ slug: "home", sliceNames: ["hero"], previewPath: "http://127.0.0.1:1", pages: [{ slug: "home" }] });
    const save = await call(api, "/pages/home/draft", auth, {
      method: "PUT",
      body: JSON.stringify({ page: { meta: { title: "Home" }, slices: [], body: "edited" } }),
    });
    expect(save.status).toBe(200);
    expect(fs.readFileSync(path.join(manifest.contentDir, ".drafts", "home.md"), "utf8")).toContain("edited");
  });

  it("takes an upload through the paired client, the bearer token riding along", async () => {
    const api = studioApi(manifest, { origin: CLOUD, token: TOKEN });
    const sent: Headers[] = [];
    // What the cloud page's pairedFetch adds, plus the Origin the browser sets.
    const client = createTyprenClient({
      baseUrl: "http://127.0.0.1:4400/api/typren",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${TOKEN}`);
        headers.set("origin", CLOUD);
        sent.push(headers);
        return api(new Request(String(input), { ...init, headers }));
      }) as typeof fetch,
    });
    const asset = await client.uploadMedia(png(), "pics");
    expect(asset.url).toMatch(/^\/img\/pics\//);
    expect(sent[0]!.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(fs.readdirSync(path.join(dir, "public", "img", "pics"))).toHaveLength(1);
  });

  it("takes the same client upload same-origin, as the local studio sends it", async () => {
    const api = createTyprenApi(studioSiteConfig(manifest, { authorize: async () => true }), { basePath: "/api/typren" });
    const client = createTyprenClient({
      baseUrl: "http://127.0.0.1:4400/api/typren",
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => api.handler(new Request(String(input), init))) as typeof fetch,
    });
    expect((await client.uploadMedia(png())).url).toMatch(/^\/img\//);
  });

  it("refuses everything else: no Origin, another origin, or no token", async () => {
    const api = studioApi(manifest, { origin: CLOUD, token: TOKEN });
    expect((await call(api, "/pages")).status).toBe(403);
    expect((await call(api, "/pages", { origin: "https://evil.test", authorization: `Bearer ${TOKEN}` })).status).toBe(403);
    expect((await call(api, "/pages", { origin: CLOUD })).status).toBe(401);
  });
});

describe("serveOnLoopback", () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  it("round-trips method, headers and a streamed body, and turns a throw into a 500", async () => {
    server = await serveOnLoopback(async (request) => {
      if (request.method === "DELETE") throw new Error("boom");
      return Response.json({ method: request.method, url: request.url, origin: request.headers.get("origin"), body: await request.text() }, { status: 201 });
    }, 0);
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/a?b=1`, { method: "POST", headers: { origin: CLOUD }, body: "hello" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ method: "POST", url: `http://127.0.0.1:0/a?b=1`, origin: CLOUD, body: "hello" });
    expect((await fetch(`http://127.0.0.1:${port}/`, { method: "DELETE" })).status).toBe(500);
  });
});
