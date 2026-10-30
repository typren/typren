import { createTyprenApi } from "@typren/core/api";
import { readManifest, studioConfig } from "@/lib/config";

// sharp (media uploads) needs Node's native bindings.
export const runtime = "nodejs";

export const { GET, POST, PUT, DELETE } = createTyprenApi(studioConfig(readManifest()), { basePath: "/api/typren" });
