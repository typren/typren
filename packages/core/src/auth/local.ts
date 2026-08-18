import type { AuthAdapter } from "../auth-adapter";

/**
 * Dev-only gate (entry `@typren/core/auth/local`, no peer deps). Refuses in
 * production unless `allowInProduction` is explicitly set. The editor writes
 * files, so never ship it open by omission. Doesn't branch on `ctx.action`, so
 * "admin" (settings/onboarding/bootstrap writes) gets the exact same local-only
 * gate as every other write. There's only one tier in local dev.
 */
export function localAuth(
  opts: {
    /** default: NODE_ENV === "development" */
    predicate?: () => boolean;
    /** default: false */
    allowInProduction?: boolean;
  } = {}
): AuthAdapter {
  const predicate = opts.predicate ?? (() => process.env.NODE_ENV === "development");
  return {
    getUser: async () => (predicate() ? { id: "local-dev", name: "Local dev" } : null),
    authorize: async () => {
      if (process.env.NODE_ENV === "production" && !opts.allowInProduction) return false;
      return predicate();
    },
  };
}
