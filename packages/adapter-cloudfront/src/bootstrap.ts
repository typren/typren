import type { CloudFrontClient, KvsClient } from "./types";
import { readFunctionSource } from "./function-source";

export const DEFAULT_FUNCTION_NAME = "typren-redirects";

export type BootstrapOptions = {
  distributionId: string;
  storeName: string;
  functionName?: string;
  /** Required to proceed when a DIFFERENT viewer-request function is already
   *  attached. Without it, bootstrap refuses rather than silently replace it:
   *  `FunctionAssociations` is a whole-list write, and blind-replacing
   *  whatever is there has caused a real outage before (see
   *  redirects.function.js's own doc comment). */
  force?: boolean;
  /** `false` publishes the bare-URL function (redirects-bare-url.function.js)
   *  instead of the trailing-slash/directory-index one. Mirrors
   *  sync-redirects' own `--trailing-slash`; keep both in sync for a site. */
  trailingSlash?: boolean;
  /** Extra path-convention segments templated into the published function
   *  (see function-source.ts's `readFunctionSource`); validated there. */
  extraPassthroughSegments?: string[];
  /** Extra cache behaviors (their own `PathPattern`, e.g. `"/assets/*"`) to
   *  also attach the function to, beyond the default cache behavior (always
   *  attached). Superseded by `allBehaviors`. */
  behaviors?: string[];
  /** Attach to every cache behavior on the distribution, default included,
   *  instead of just the default plus `behaviors`. A distribution with
   *  `CacheBehaviors` typren doesn't know about ahead of time (continuous
   *  deployment staging configs are one example) is the usual reason to
   *  reach for this over listing each pattern. */
  allBehaviors?: boolean;
};

export type BootstrapResult =
  | { ok: true; createdKvs: boolean; functionArn: string }
  | { ok: false; error: string };

/**
 * Guarded, idempotent one-time setup on an EXISTING CloudFront distribution:
 * create the KeyValueStore if it doesn't exist yet, upsert+publish the
 * canonical viewer-request function associated with it, then attach that
 * function to the distribution's default cache behavior and, via `behaviors`/
 * `allBehaviors`, any extra `CacheBehaviors`. Never creates the distribution
 * or its origin, that's IaC (Terraform/CDK/SST) territory.
 *
 * Checks what's already attached BEFORE replacing it, across EVERY cache
 * behavior (not just the ones this call targets): re-running this with the
 * same functionName is a safe no-op-ish upsert, but a DIFFERENT function
 * already in place anywhere on the distribution needs `force` to acknowledge
 * the replace.
 */
export async function bootstrapDistribution(kvsClient: KvsClient, cfClient: CloudFrontClient, opts: BootstrapOptions): Promise<BootstrapResult> {
  const functionName = opts.functionName ?? DEFAULT_FUNCTION_NAME;

  const attached = await cfClient.getAttachedFunctionNames(opts.distributionId);
  const others = attached.filter((name) => name !== functionName);
  if (others.length > 0 && !opts.force) {
    return {
      ok: false,
      error:
        `typren-cloudfront bootstrap: distribution "${opts.distributionId}" already has a different ` +
        `viewer-request function attached (${others.join(", ")}). Read what it does before replacing it — ` +
        `re-run with force to proceed.`,
    };
  }

  let createdKvs = false;
  let storeArn: string;
  try {
    storeArn = (await kvsClient.describeStore(opts.storeName)).arn;
  } catch {
    storeArn = (await cfClient.createKeyValueStore(opts.storeName, "typren redirects (see @typren/adapter-cloudfront)")).arn;
    createdKvs = true;
  }

  const { arn: functionArn } = await cfClient.upsertFunction(
    functionName,
    readFunctionSource({ trailingSlash: opts.trailingSlash, extraPassthroughSegments: opts.extraPassthroughSegments }),
    storeArn,
    "typren canonical viewer-request function (index rewrite + bare→slash + KVS redirects)"
  );
  const behaviors = opts.allBehaviors ? "*" : ["default", ...(opts.behaviors ?? [])];
  await cfClient.setViewerRequestFunction(opts.distributionId, functionArn, behaviors);

  return { ok: true, createdKvs, functionArn };
}
