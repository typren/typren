import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createRouteContractSuite } from "@typren/contract-tests";
import { createTyprenApi } from "./routes";
import { createMarkdownAdapter } from "../markdown-adapter";
import type { AuthAdapter } from "../auth-adapter";
import type { CmsConfig } from "../types";

/**
 * Runs @typren/contract-tests' REST route conformance suite against this
 * package's own `createTyprenApi`, proving the fixtures actually match the
 * shipped handler (see docs/hosted-platform.md#cross-repo-compatibility item
 * 3). Editor and cloud run the same suite against whatever core version they
 * install.
 */
const BASE = "/api/typren";
let dir: string;

const openAuth: AuthAdapter = { getUser: async () => ({ id: "test" }), authorize: async () => true };

function makeConfig(): CmsConfig {
  return {
    registry: {},
    defaults: {},
    adapter: createMarkdownAdapter({ contentDir: dir, draftDir: path.join(dir, ".drafts") }),
    previewPath: "/editor/preview",
    auth: openAuth,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-contract-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

createRouteContractSuite(() => createTyprenApi(makeConfig(), { basePath: BASE }).handler, { basePath: BASE });
