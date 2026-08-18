// Public entry for the "@typren/core/api" subpath: the HTTP handler factory (server)
// and the typed client for the editor's REST API.
//
// SERVER-ONLY, despite the client re-export below: `./routes` reaches
// store/collection/media, so this barrel drags `node:fs` into whatever imports
// it. Browser code must import "@typren/core/api/client" instead: the same
// `createTyprenClient`, none of the server graph. (A consumer that took this
// barrel client-side had to hand-roll a 100-line fetch shim to avoid it.)
export { createTyprenApi, type TyprenApiOptions } from "./routes";
export { createTyprenClient, TyprenApiError, type TyprenClient, type TyprenClientOptions } from "./client";
