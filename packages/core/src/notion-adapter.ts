import { spawnSync } from "node:child_process";
import type { ContentAdapter, PageContent } from "./types";

/** Notion property types this adapter can round-trip: text, numbers,
 *  single/multi enums, booleans, dates, and a relation to another database —
 *  not Notion's full property-type list (no formula, rollup, people, files:
 *  none of those round-trip meaningfully through a plain read/write value,
 *  being either computed or reference-shaped in ways a generic mapper can't
 *  own). A site with a genuine need for one of those maps it via its own
 *  property glue rather than growing this list. */
export type NotionPropertyType =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "status"
  | "multi_select"
  | "checkbox"
  | "date"
  | "email"
  | "phone_number"
  | "url"
  | "relation";

/** metaKey -> which Notion property backs it and how to (de)serialize it.
 *  Every key here becomes a field on the record's `meta`; any other property
 *  on the Notion row is ignored (not read, not written, not clobbered). */
export type NotionPropertyMap = Record<string, { name: string; type: NotionPropertyType }>;

/** Raw per-property JSON Notion returns/expects for one property, e.g.
 *  `{ number: 42 }`, `{ title: [{ plain_text: "..." }] }`. Untyped beyond
 *  "a JSON object" — its shape depends on the property's Notion type. */
export type NotionRawProperty = Record<string, unknown>;

/** One Notion database row, trimmed to what this adapter needs. `properties`
 *  is keyed by Notion property name. */
export type NotionPage = { id: string; archived: boolean; properties: Record<string, NotionRawProperty> };

/**
 * The seam between the adapter and Notion's HTTP API — mocked directly in
 * tests (see notion-adapter.test.ts), so no network/HTTP-mocking library is
 * needed to unit-test the adapter's read/write/mapping logic. Every method is
 * SYNCHRONOUS to satisfy `ContentAdapter` (see `createFetchNotionClient`'s
 * doc comment for how the real implementation bridges Notion's async HTTP
 * to that).
 */
export interface NotionClient {
  /** Every non-archived row in the database (pagination is the client's problem). */
  queryDatabase(databaseId: string): NotionPage[];
  /** `null` when the page id doesn't exist OR is archived (this adapter
   *  treats "archived" as "deleted", see `deletePublished`). */
  retrievePage(pageId: string): NotionPage | null;
  createPage(databaseId: string, properties: Record<string, NotionRawProperty>): NotionPage;
  updatePage(pageId: string, properties: Record<string, NotionRawProperty>): NotionPage;
  /** Notion has no hard delete via the API, only archive (= its trash). */
  archivePage(pageId: string): void;
}

/** Narrow an unknown JSON value to a plain object, or `{}` when it isn't one
 *  (covers `null`/absent sub-fields without a cast at every call site). */
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
/** Same, for the array-of-objects properties (title/rich_text/multi_select/relation). */
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);
/** A Notion rich-text run's plain string, from either a real API response
 *  (`plain_text`) or the shape a caller writes (`text.content`, see
 *  `writeProp`) — the fallback means a page just created/updated through
 *  THIS adapter reads back correctly even from a test double that echoes the
 *  write payload verbatim instead of round-tripping it through Notion's own
 *  response normalization. */
const runText = (run: Record<string, unknown>): string =>
  (run.plain_text as string | undefined) ?? (obj(run.text).content as string | undefined) ?? "";

function readProp(raw: NotionRawProperty | undefined, name: string, type: NotionPropertyType): unknown {
  if (raw === undefined) return type === "multi_select" || type === "relation" ? [] : null;
  // Real Notion responses carry the property's own `type` tag; a mismatch
  // against the configured type is a config bug (wrong property name/type in
  // NotionPropertyMap) that would otherwise silently read `undefined` off
  // the wrong key — loud beats a silently-wrong value here.
  if ("type" in raw && raw.type !== type)
    throw new Error(`typren: notion property "${name}" expected type "${type}" but got "${String(raw.type)}"`);
  switch (type) {
    case "title":
      return arr(raw.title).map(runText).join("");
    case "rich_text":
      return arr(raw.rich_text).map(runText).join("");
    case "number":
      return raw.number ?? null;
    case "select":
      return obj(raw.select).name ?? null;
    case "status":
      return obj(raw.status).name ?? null;
    case "multi_select":
      return arr(raw.multi_select).map((o) => o.name);
    case "checkbox":
      return !!raw.checkbox;
    case "date":
      return obj(raw.date).start ?? null;
    case "email":
      return raw.email ?? null;
    case "phone_number":
      return raw.phone_number ?? null;
    case "url":
      return raw.url ?? null;
    case "relation":
      return arr(raw.relation).map((r) => r.id);
  }
}

function writeProp(value: unknown, type: NotionPropertyType): Record<string, unknown> {
  switch (type) {
    case "title":
      return { title: value ? [{ type: "text", text: { content: String(value) } }] : [] };
    case "rich_text":
      return { rich_text: value ? [{ type: "text", text: { content: String(value) } }] : [] };
    case "number":
      return { number: value === null || value === undefined ? null : Number(value) };
    case "select":
      return { select: value ? { name: String(value) } : null };
    case "status":
      return { status: value ? { name: String(value) } : null };
    case "multi_select":
      return { multi_select: (Array.isArray(value) ? value : []).map((v) => ({ name: String(v) })) };
    case "checkbox":
      return { checkbox: !!value };
    case "date":
      return { date: value ? { start: String(value) } : null };
    case "email":
      return { email: (value as string) ?? null };
    case "phone_number":
      return { phone_number: (value as string) ?? null };
    case "url":
      return { url: (value as string) ?? null };
    case "relation":
      return { relation: (Array.isArray(value) ? value : []).map((id) => ({ id: String(id) })) };
  }
}

export type NotionAdapterOptions = {
  client: NotionClient;
  databaseId: string;
  properties: NotionPropertyMap;
  /** metaKey of a plain-text-valued property (title/rich_text/select/status)
   *  that uniquely and stably identifies a row, used as the record slug in
   *  place of the Notion page id. Required to CREATE new records through this
   *  adapter (`writeRaw` on an unknown slug): a page id doesn't exist until
   *  Notion assigns one, so it can't be the slug a caller picks up front.
   *  Omit for read/update/delete-only use against rows that already exist
   *  (slug = Notion page id) — fine for collections whose records are only
   *  ever created in Notion directly. */
  slugProperty?: string;
  /** metaKey of a rich_text property to round-trip as `PageContent.body`.
   *  Omit when the collection is property-only (body is always ""), which
   *  is the normal case for the row-shaped entities this adapter targets. */
  bodyProperty?: string;
  locales?: string[];
  defaultLocale?: string;
};

/**
 * Notion-backed `ContentAdapter`. One database row = one record; `meta` is
 * the schema-shaped prop bag (see `NotionPropertyMap`), `body` is optional
 * (see `bodyProperty`), `slices` is always `[]` (Notion has no slice concept,
 * matching how a markdown *collection* record already has no slices either).
 *
 * typren: Notion has no draft/publish distinction (unlike the filesystem
 * adapter's separate `.drafts` dir) — every draft op writes straight through
 * to the published row (`writeDraftRaw` calls the same path as `writeRaw`;
 * `readDraftRaw`/`hasDraft` always report "no draft" so `ContentStore.publish`
 * safely no-ops after the write-through already landed). This drops
 * optimistic-locking and "unpublished changes" UX for Notion-backed
 * collections. Parked as an open question for Gabriel (queue
 * T-20260810-riau-06), not silently dropped: revisit if the admin needs a
 * real draft/review step, e.g. writing to a "Draft" Notion property or a
 * shadow database instead of aliasing to published.
 */
export function createNotionAdapter({
  client,
  databaseId,
  properties,
  slugProperty,
  bodyProperty,
  defaultLocale = "en",
  locales = [defaultLocale],
}: NotionAdapterOptions): ContentAdapter {
  const safeLocale = (loc?: string): string => {
    const l = loc ?? defaultLocale;
    if (!locales.includes(l)) throw new Error(`typren: unknown locale "${l}"`);
    return l;
  };

  const slugDef = slugProperty ? properties[slugProperty] : undefined;
  if (slugProperty && !slugDef) throw new Error(`typren: slugProperty "${slugProperty}" is not in properties`);

  const slugOf = (page: NotionPage): string =>
    slugDef ? String(readProp(page.properties[slugDef.name], slugDef.name, slugDef.type) ?? "") : page.id;

  const findBySlug = (slug: string): NotionPage | null => {
    if (!slugDef) {
      const page = client.retrievePage(slug);
      return page && !page.archived ? page : null;
    }
    // ponytail: no server-side filter (Notion's filter JSON shape is
    // property-type-specific, a lot of code for what's an internal lookup) —
    // scan the full listing client-side instead. Fine for admin-table-sized
    // databases; swap in a filtered query if a collection grows into the
    // thousands of rows.
    return client.queryDatabase(databaseId).find((p) => !p.archived && slugOf(p) === slug) ?? null;
  };

  const metaFromPage = (page: NotionPage): Record<string, unknown> => {
    const meta: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(properties)) meta[key] = readProp(page.properties[def.name], def.name, def.type);
    return meta;
  };

  const bodyFromPage = (page: NotionPage): string => {
    if (!bodyProperty) return "";
    const def = properties[bodyProperty] ?? { name: bodyProperty, type: "rich_text" as const };
    return String(readProp(page.properties[def.name], def.name, def.type) ?? "");
  };

  const toRaw = (page: NotionPage): string => JSON.stringify({ meta: metaFromPage(page), body: bodyFromPage(page) });

  const propsFromMeta = (meta: Record<string, unknown>, body: string): Record<string, NotionRawProperty> => {
    const out: Record<string, NotionRawProperty> = {};
    for (const [key, def] of Object.entries(properties)) if (key in meta) out[def.name] = writeProp(meta[key], def.type);
    if (bodyProperty) {
      const def = properties[bodyProperty] ?? { name: bodyProperty, type: "rich_text" as const };
      out[def.name] = writeProp(body, def.type);
    }
    return out;
  };

  const doWriteRaw = (slug: string, raw: string, locale?: string): void => {
    safeLocale(locale);
    const { meta, body } = JSON.parse(raw) as { meta: Record<string, unknown>; body: string };
    const props = propsFromMeta(meta, body);
    const existing = findBySlug(slug);
    if (existing) {
      client.updatePage(existing.id, props);
      return;
    }
    if (!slugDef)
      throw new Error(
        `typren: cannot create notion record "${slug}" without a slugProperty configured (a page id can't be chosen ahead of creation)`
      );
    props[slugDef.name] = writeProp(slug, slugDef.type);
    client.createPage(databaseId, props);
  };

  return {
    locales,
    defaultLocale,
    root: `notion:${databaseId}`,

    listSlugs(locale) {
      safeLocale(locale);
      return client
        .queryDatabase(databaseId)
        .filter((p) => !p.archived)
        .map(slugOf)
        .sort((a, b) => a.localeCompare(b));
    },

    listLocales(slug) {
      return findBySlug(slug) ? locales : [];
    },

    exists(slug, locale) {
      safeLocale(locale);
      return findBySlug(slug) !== null;
    },

    readRaw(slug, locale) {
      safeLocale(locale);
      const page = findBySlug(slug);
      if (!page) throw new Error(`typren: notion record "${slug}" not found`);
      return toRaw(page);
    },

    writeRaw: doWriteRaw,

    deletePublished(slug, locale) {
      safeLocale(locale);
      const page = findBySlug(slug);
      if (page) client.archivePage(page.id);
    },

    // See the write-through note in this function's doc comment above.
    readDraftRaw() {
      return null;
    },
    writeDraftRaw: doWriteRaw,
    deleteDraft() {
      // no-op: there is no separate draft row to remove
    },
    hasDraft() {
      return false;
    },

    parse(raw: string): PageContent {
      const { meta, body } = JSON.parse(raw) as { meta: Record<string, unknown>; body: string };
      return { meta, slices: [], body };
    },
    serialize(page: PageContent): string {
      return JSON.stringify({ meta: page.meta, body: page.body });
    },
  };
}

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// ponytail: `ContentAdapter` (./types.ts) is sync-only — typren issue #29
// tracks an async-ContentAdapter follow-up that hasn't landed. Notion is
// HTTP-only (inherently async), so *something* has to bridge the two.
// This shells a one-shot child Node process per call that does the real
// fetch and prints the JSON result on stdout; `spawnSync` blocks this thread
// until it exits, giving a genuinely synchronous call — not a stale cache,
// not a silently fire-and-forget write, an actual round trip. Ceiling: one
// process spawn per Notion call (spawn overhead on top of network latency).
// Fine for a local, never-deployed admin tool at admin-table row counts; not
// for a high-QPS server. Upgrade: delete this function and call `fetch`
// directly the day `ContentAdapter`'s methods return promises.
function notionRequestSync(token: string, method: string, path: string, body?: unknown): Record<string, unknown> {
  const script =
    "const [url, init] = process.argv.slice(1).map((s) => JSON.parse(s));" +
    "fetch(url, init).then(async (r) => { const text = await r.text();" +
    "process.stdout.write(JSON.stringify({ status: r.status, text })); })" +
    ".catch((e) => { process.stdout.write(JSON.stringify({ status: 0, text: String(e && e.message || e) })); });";
  const init = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const result = spawnSync(process.execPath, ["-e", script, JSON.stringify(`${NOTION_API}${path}`), JSON.stringify(init)], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw new Error(`typren: notion request failed: ${result.error.message}`);
  if (!result.stdout) throw new Error(`typren: notion request produced no output: ${result.stderr}`);
  const { status, text } = JSON.parse(result.stdout) as { status: number; text: string };
  if (status === 0) throw new Error(`typren: notion request errored: ${text}`);
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (status >= 400) throw new Error(`typren: notion API ${method} ${path} -> ${status} ${JSON.stringify(json)}`);
  return json;
}

function toNotionPage(json: Record<string, unknown>): NotionPage {
  return {
    id: json.id as string,
    archived: !!json.archived,
    properties: (json.properties as Record<string, NotionRawProperty>) ?? {},
  };
}

/** Real `NotionClient` against `https://api.notion.com`. `token` is an
 *  internal-integration secret — pass it from `process.env` only (never
 *  commit one); the caller owns getting it there. */
export function createFetchNotionClient(token: string): NotionClient {
  return {
    queryDatabase(databaseId) {
      const pages: NotionPage[] = [];
      let cursor: string | undefined;
      do {
        const json = notionRequestSync(
          token,
          "POST",
          `/databases/${databaseId}/query`,
          cursor ? { start_cursor: cursor } : {}
        );
        const results = (json.results as Record<string, unknown>[] | undefined) ?? [];
        pages.push(...results.map(toNotionPage));
        cursor = json.has_more ? (json.next_cursor as string) : undefined;
      } while (cursor);
      return pages;
    },
    retrievePage(pageId) {
      try {
        return toNotionPage(notionRequestSync(token, "GET", `/pages/${pageId}`));
      } catch (e) {
        if (e instanceof Error && /-> 404\b/.test(e.message)) return null;
        throw e;
      }
    },
    createPage(databaseId, properties) {
      return toNotionPage(
        notionRequestSync(token, "POST", "/pages", { parent: { database_id: databaseId }, properties })
      );
    },
    updatePage(pageId, properties) {
      return toNotionPage(notionRequestSync(token, "PATCH", `/pages/${pageId}`, { properties }));
    },
    archivePage(pageId) {
      notionRequestSync(token, "PATCH", `/pages/${pageId}`, { archived: true });
    },
  };
}
