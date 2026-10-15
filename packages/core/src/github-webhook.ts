/**
 * GitHub push-webhook handler for a site whose content lives in a
 * `createGithubAdapter`-backed repo (issue #29's "git runtime"): a host
 * mounts this at its webhook route, GitHub POSTs on every push, and
 * `onChange` is the host's own cache-invalidation hook (e.g. Next's
 * `revalidateTag`, see the README's "Live content from GitHub" section).
 * Web-standard `Request`/`Response`, same convention as
 * `@typren/forms`'s `createFormHandler`: one function that mounts on Next
 * Route Handlers, Workers, Lambda function URLs, or Hono alike.
 */

export type GithubWebhookChange = {
  /** Every added/modified/removed path under `contentDir` this push touched,
   *  repo-relative (e.g. "content/about.md"), draft paths already excluded. */
  paths: string[];
  /** Slugs derived from the `.md` paths above (both locale-prefixed and flat). */
  slugs: string[];
  /** Locales present in `paths` (a flat/default-locale path contributes none:
   *  there is no locale segment to read off it). */
  locales: string[];
  /** True when the push can't be enumerated reliably (force push, or no
   *  commit list in the payload): `paths`/`slugs`/`locales` are then empty and
   *  the host must invalidate ALL Typren content, or the rewritten pages stay
   *  stale until something else touches them. */
  full: boolean;
};

export type GithubWebhookOptions = {
  /** The webhook's configured secret, used to verify `X-Hub-Signature-256`.
   *  Required: a webhook with no secret is an unauthenticated endpoint that
   *  lets anyone trigger `onChange` by guessing the URL. */
  secret: string;
  /** Only a push to this branch triggers `onChange`; every other branch is
   *  202 Accepted (ignored), not rejected (another branch pushing is normal
   *  repo activity, not an error). Default "main". */
  branch?: string;
  /** Repo-relative content directory, matching the `createGithubAdapter`
   *  instance this webhook invalidates for. Default "content". */
  contentDir?: string;
  /** Draft subdirectory name, matching the adapter's own `draftSubdir`. A
   *  draft-only push never fires `onChange`: draft reads are never cached
   *  (see `readInit`'s doc comment on `GithubAdapterOptions`), so there is
   *  nothing to invalidate. Default "_drafts". */
  draftSubdir?: string;
  /** The host's cache-invalidation hook, e.g.
   *  `() => revalidateTag("typren-content")`. Thrown errors become a 500 so
   *  GitHub retries/redelivers the webhook rather than silently losing the
   *  invalidation. */
  onChange: (change: GithubWebhookChange) => void | Promise<void>;
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;

type GithubCommit = { added?: string[]; modified?: string[]; removed?: string[] };
type GithubPushPayload = { ref?: string; forced?: boolean; deleted?: boolean; commits?: GithubCommit[] };

/** Reads `req.body` incrementally, counting bytes as they arrive, and bails
 *  out (canceling the stream, never buffering the rest) the moment the
 *  running total exceeds `maxBytes`. A chunked request carries no
 *  `content-length` at all, so a header-only size check (the previous
 *  version of this guard) never fires for one; this closes that gap by
 *  checking the ACTUAL bytes received rather than trusting a header. Returns
 *  `null` to mean "too large", never throws for that case. */
async function readBodyCapped(req: Request, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare: always walks every byte of the LONGER input rather
 *  than short-circuiting on the first mismatch or on a length difference, so
 *  neither the content nor the length of a wrong signature leaks via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  return diff === 0;
}

async function verifySignature(secret: string, body: ArrayBuffer, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, body);
  return timingSafeEqual(`sha256=${toHex(mac)}`, header);
}

/** Strips `contentDir/` and excludes anything under `draftSubdir` at any
 *  nesting level (flat default-locale drafts, or `<locale>/<draftSubdir>/`). */
function relevantPaths(paths: string[], contentDir: string, draftSubdir: string): string[] {
  const prefix = `${contentDir}/`;
  const draftSegment = `/${draftSubdir}/`;
  return paths
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
    .filter((rel) => rel !== draftSubdir && !rel.startsWith(`${draftSubdir}/`) && !rel.includes(draftSegment));
}

/** Default locale lives flat at `contentDir/<slug>.md`; any other locale
 *  lives one directory deeper, `contentDir/<locale>/<slug>.md` (mirrors
 *  `createGithubAdapter`'s own layout, see github-adapter.ts). */
function slugAndLocale(relPath: string): { slug: string; locale?: string } | null {
  if (!relPath.endsWith(".md")) return null;
  const segments = relPath.split("/");
  if (segments.length === 1) return { slug: segments[0].replace(/\.md$/, "") };
  if (segments.length === 2) return { locale: segments[0], slug: segments[1].replace(/\.md$/, "") };
  return null; // deeper nesting (e.g. a collection dir) isn't a Pages slug
}

// GitHub's own commit-list cap per push payload; a push with this many (or
// more) is truncated, not exhaustive, the same as an empty list or a force
// push -- see the commits.length check below.
const GITHUB_PUSH_COMMIT_CAP = 2048;

// X-GitHub-Delivery ids seen recently, oldest-first (Map preserves insertion
// order), so a redelivered webhook (GitHub retries on a non-2xx, and a host
// can also manually redeliver from its UI) 202s instead of invalidating twice.
// ponytail: per-handler-instance only, in-memory -- a redelivery landing on a
// DIFFERENT instance (multi-instance deploy) still processes. Upgrade path: a
// shared store (KV/Redis) keyed by delivery id, if duplicate invalidations
// ever actually show up in practice (they're idempotent, just wasted work).
const MAX_SEEN_DELIVERIES = 1000;

export function createGithubWebhookHandler(options: GithubWebhookOptions): (req: Request) => Promise<Response> {
  const { secret, branch = "main", contentDir = "content", draftSubdir = "_drafts", onChange } = options;
  if (!secret) throw new Error("typren: createGithubWebhookHandler requires a non-empty secret");

  // A delivery counts as seen only once onChange has succeeded for it. Recording it on arrival meant
  // a failed onChange (500, so GitHub retries) had its retry swallowed as a replay, and the
  // invalidation never happened. Ignored events are never recorded; re-ignoring them is free.
  const seenDeliveries = new Map<string, true>();
  function markSeen(deliveryId: string | null): void {
    if (!deliveryId) return;
    seenDeliveries.set(deliveryId, true);
    if (seenDeliveries.size > MAX_SEEN_DELIVERIES) {
      const oldest = seenDeliveries.keys().next().value;
      if (oldest !== undefined) seenDeliveries.delete(oldest);
    }
  }

  return async (req: Request): Promise<Response> => {
    // Fast-path reject when a (numeric) content-length already says the body
    // is too large, without opening the stream at all. A chunked request (or
    // a non-numeric/garbage header) has no usable content-length here, so the
    // REAL guard is the streaming byte count below.
    const contentLengthHeader = req.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return new Response("Payload too large", { status: 413 });
    }

    const bodyBuffer = await readBodyCapped(req, MAX_BODY_BYTES);
    if (bodyBuffer === null) return new Response("Payload too large", { status: 413 });

    // Signature verified over the RAW body, before any JSON parsing.
    const valid = await verifySignature(secret, bodyBuffer, req.headers.get("x-hub-signature-256"));
    if (!valid) return new Response("Invalid signature", { status: 401 });

    const deliveryId = req.headers.get("x-github-delivery");
    if (deliveryId && seenDeliveries.has(deliveryId)) {
      return new Response("Already processed", { status: 202 });
    }

    const event = req.headers.get("x-github-event");
    if (event === "ping") return new Response("pong", { status: 200 });
    if (event !== "push") return new Response("Ignored: not a push event", { status: 202 });

    let payload: GithubPushPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(bodyBuffer)) as GithubPushPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.ref !== `refs/heads/${branch}`) return new Response("Ignored: other branch", { status: 202 });

    // A force push rewrites history the commit list doesn't describe, an
    // empty list (GitHub caps it, and some pushes carry none) proves nothing
    // changed only if it really is complete, and a list AT GitHub's own cap
    // is itself truncated (more commits existed than the payload lists) --
    // all three fall back to "everything".
    if (!payload.deleted && (payload.forced || !payload.commits?.length || payload.commits.length >= GITHUB_PUSH_COMMIT_CAP)) {
      return runOnChange({ paths: [], slugs: [], locales: [], full: true }, deliveryId);
    }

    const allPaths = (payload.commits ?? []).flatMap((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]);
    const paths = [...new Set(relevantPaths(allPaths, contentDir, draftSubdir))];
    if (paths.length === 0) return new Response("Ignored: draft-only or unrelated paths", { status: 202 });

    const slugs = new Set<string>();
    const locales = new Set<string>();
    for (const rel of paths) {
      const parsed = slugAndLocale(rel);
      if (!parsed) continue;
      slugs.add(parsed.slug);
      if (parsed.locale) locales.add(parsed.locale);
    }

    return runOnChange(
      { paths: paths.map((p) => `${contentDir}/${p}`), slugs: [...slugs], locales: [...locales], full: false },
      deliveryId
    );
  };

  async function runOnChange(change: GithubWebhookChange, deliveryId: string | null): Promise<Response> {
    try {
      await onChange(change);
    } catch (e) {
      return new Response(`onChange failed: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }
    markSeen(deliveryId);
    return new Response("OK", { status: 200 });
  }
}
