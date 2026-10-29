import http from "node:http";
import { Readable } from "node:stream";
import { loadStudioProps, studioSiteConfig, type AuthAdapter, type StudioManifest } from "@typren/core";
import { createTyprenApi } from "@typren/core/api";

/** Where the API is mounted, the same path the local studio app uses. */
export const API_BASE = "/api/typren";

/**
 * Lets every action through: the pairing token is this server's whole
 * authentication, and `studioApi` lets no request reach an action without it
 * (the paired origin's requests are token-checked by `createTyprenApi`, and
 * every other request is refused first). Slug, locale and media-id checks
 * still run in the adapters.
 */
const pairedAuth: AuthAdapter = { authorize: async () => true };

/**
 * The connected studio's API: the site's content API, plus `GET /studio`
 * (the studio's initial props), callable only from `cloud.origin` with
 * `Authorization: Bearer <cloud.token>`. A request from anywhere else,
 * including one with no Origin (curl, another local process, a DNS-rebinding
 * page reading its "own" origin), is refused before routing.
 */
export function studioApi(manifest: StudioManifest, cloud: { origin: string; token: string }): (request: Request) => Promise<Response> {
  const config = studioSiteConfig(manifest, pairedAuth);
  const api = createTyprenApi(config, {
    basePath: API_BASE,
    allowOrigin: cloud,
    studio: (request) => loadStudioProps(config, manifest, new URL(request.url).searchParams.get("slug")),
  });
  return async (request) =>
    request.headers.get("origin") === cloud.origin ? api.handler(request) : Response.json({ error: "Cross-origin request refused" }, { status: 403 });
}

/**
 * Serves a WHATWG `Request -> Response` handler on node:http at
 * 127.0.0.1:`port`, streaming bodies both ways. Resolves once listening.
 * ponytail: node:http plus `Readable.toWeb/fromWeb` covers one fetch-style
 * handler; no server framework for a single route tree.
 */
export function serveOnLoopback(handler: (request: Request) => Promise<Response>, port: number): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      // The URL's origin is fixed: never built from the request's Host header.
      const request = new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        duplex: "half",
      } as RequestInit);
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body as never).pipe(res);
      else res.end();
    } catch (e) {
      console.error("typren studio: API error", e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
