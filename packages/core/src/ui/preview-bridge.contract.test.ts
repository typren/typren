import { createPreviewBridgeContractSuite } from "@typren/contract-tests";
import { initPreviewBridge } from "./preview-bridge.vanilla";

/**
 * Runs @typren/contract-tests' preview-bridge conformance suite against this
 * package's own `initPreviewBridge` (see
 * docs/hosted-platform.md#cross-repo-compatibility item 3). Also the first
 * test coverage this file has had.
 */
createPreviewBridgeContractSuite(initPreviewBridge);
