import { createHash } from "node:crypto";

/** Content version = SHA-256 of the raw file text, truncated. Deterministic and
 *  adapter-agnostic (survives fs → KV → git), no mtime flakiness. */
export const versionOf = (raw: string): string =>
  createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);

/** Thrown by the store when a version-checked write loses a race. The action
 *  layer converts this to returned data (Next redacts thrown messages in prod),
 *  so callers detect conflicts via the returned union, not `e.message`. */
export class ConflictError extends Error {
  readonly code = "conflict" as const;
  constructor(
    readonly slug: string,
    readonly currentVersion: string | null,
    readonly baseVersion: string
  ) {
    super(`typren: "${slug}" was changed by someone else`);
    this.name = "ConflictError";
  }
}

/** Thrown by the store when a rename/duplicate would land on a slug that
 *  already has content (published or draft) in some locale. Distinct from
 *  `ConflictError`: that's an optimistic-lock version race on ONE resource;
 *  this is two resources colliding, so there's no `currentVersion`/`baseVersion`
 *  to report. Carries the same `code: "conflict"` discriminant so the action
 *  layer's result union and the 409 mapping in `api/routes.ts`'s `saveResult()`
 *  don't need a second code path. */
export class SlugExistsError extends Error {
  readonly code = "conflict" as const;
  constructor(readonly slug: string) {
    super(`typren: "${slug}" already exists`);
    this.name = "SlugExistsError";
  }
}
