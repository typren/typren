import { describe, it, expect, vi } from "vitest";
import { createContentAdapterContractSuite } from "@typren/contract-tests";
import { createFetchNotionClient, createNotionAdapter, type NotionClient, type NotionPage } from "./notion-adapter";
import type { NotionBlock } from "./notion-blocks";

/** Hand-rolled in-memory `NotionClient`: no network, no mocking library;
 *  same spirit as markdown-adapter.test.ts using a real temp dir instead of
 *  mocking `node:fs`. `blocksByPageId` is only used by the content:"blocks"
 *  tests; omitting it (the default) leaves `listBlockChildren` unset, same
 *  as a real client with no block support. */
function fakeClient(
  seed: NotionPage[] = [],
  blocksByPageId: Record<string, NotionBlock[]> = {},
  databaseId = "db1"
): NotionClient & { pages: NotionPage[] } {
  // Every seeded/created page belongs to `databaseId` unless the seed says
  // otherwise (the "page from another database" test seeds one that doesn't),
  // matching how a real Notion row always carries its own parent database.
  const pages: NotionPage[] = seed.map((p) => ({ ...p, parent: p.parent ?? { database_id: databaseId } }));
  let nextId = 1;
  return {
    pages,
    queryDatabase: async () => pages.filter((p) => !p.archived),
    retrievePage: async (id) => pages.find((p) => p.id === id) ?? null,
    createPage: async (_databaseId, properties) => {
      const page: NotionPage = {
        id: `page-${nextId++}`,
        archived: false,
        properties: { ...properties },
        parent: { database_id: databaseId },
      };
      pages.push(page);
      return page;
    },
    updatePage: async (id, properties) => {
      const page = pages.find((p) => p.id === id);
      if (!page) throw new Error(`no such page ${id}`);
      Object.assign(page.properties, properties);
      return page;
    },
    archivePage: async (id) => {
      const page = pages.find((p) => p.id === id);
      if (page) page.archived = true;
    },
    ...(Object.keys(blocksByPageId).length ? { listBlockChildren: async (id: string) => blocksByPageId[id] ?? [] } : {}),
  };
}

const properties = {
  name: { name: "Name", type: "title" as const },
  balance: { name: "Balance", type: "number" as const },
  active: { name: "Active", type: "checkbox" as const },
};

describe("notion-adapter list/read", () => {
  it("lists and reads records keyed by page id when no slugProperty is set", async () => {
    const client = fakeClient([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        archived: false,
        properties: {
          Name: { title: [{ plain_text: "Ada Lovelace" }] },
          Balance: { number: 42 },
          Active: { checkbox: true },
        },
      },
    ]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties });

    expect(await adapter.listSlugs()).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
    expect(await adapter.exists("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe(true);
    expect(await adapter.exists("dddddddd-dddd-dddd-dddd-dddddddddddd")).toBe(false); // valid shape, not seeded
    expect(await adapter.listLocales("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toEqual(["en"]);
    expect(await adapter.listLocales("dddddddd-dddd-dddd-dddd-dddddddddddd")).toEqual([]);

    const parsed = adapter.parse(await adapter.readRaw("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    expect(parsed).toEqual({ meta: { name: "Ada Lovelace", balance: 42, active: true }, slices: [], body: "" });
  });

  it("throws reading a slug that doesn't exist", async () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    await expect(adapter.readRaw("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")).rejects.toThrow(/not found/);
  });

  it("excludes archived rows from listSlugs/exists", async () => {
    const client = fakeClient([{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", archived: true, properties: {} }]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties });
    expect(await adapter.listSlugs()).toEqual([]);
    expect(await adapter.exists("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe(false);
  });

  it("throws loud on a property-type mismatch against a real Notion response", async () => {
    const client = fakeClient([{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", archived: false, properties: { Balance: { type: "select", select: null } } }]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: { balance: properties.balance } });
    await expect(adapter.readRaw("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).rejects.toThrow(/expected type "number" but got "select"/);
  });

  it("rejects a slug shaped like a path-traversal attempt against the page id, without a slugProperty", async () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    const call = adapter.readRaw("../databases/x");
    expect(call).toBeInstanceOf(Promise);
    await expect(call).rejects.toThrow(/not a valid Notion page id/);
  });

  it("rejects any non-UUID-shaped slug, dashed or not, without a slugProperty", async () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    await expect(adapter.readRaw("not-a-uuid")).rejects.toThrow(/not a valid Notion page id/);
    await expect(adapter.exists("short-id")).rejects.toThrow(/not a valid Notion page id/);
  });

  it("accepts a bare 32-hex-char id (no dashes), the same page id in its other valid form", async () => {
    const client = fakeClient([{ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", archived: false, properties: {} }]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties });
    expect(await adapter.exists("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
  });

  it("treats a page that belongs to a DIFFERENT database as not found", async () => {
    const client = fakeClient([
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", archived: false, properties: {}, parent: { database_id: "some-other-db" } },
    ]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties });

    expect(await adapter.exists("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toBe(false);
    await expect(adapter.readRaw("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).rejects.toThrow(/not found/);
  });

  it("normalizes dashes when comparing the page's parent database against the configured one", async () => {
    const client = fakeClient([
      {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        archived: false,
        properties: {},
        // Parent database id WITH dashes; the adapter below is configured
        // with the same id WITHOUT them -- the same logical database either
        // way, matching how Notion's own ids appear in both forms.
        parent: { database_id: "dddddddd-1111-2222-3333-444444444444" },
      },
    ]);
    const adapter = createNotionAdapter({ client, databaseId: "dddddddd111122223333444444444444", properties });
    expect(await adapter.exists("cccccccc-cccc-cccc-cccc-cccccccccccc")).toBe(true);
  });
});

describe("notion-adapter write/delete round-trip", () => {
  it("creates a new record via slugProperty, updates it, then deletes (archives) it", async () => {
    const client = fakeClient();
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties, slugProperty: "name" });

    const raw = adapter.serialize({ meta: { name: "ada-lovelace", balance: 10, active: false }, slices: [], body: "" });
    await adapter.writeRaw("ada-lovelace", raw);
    expect(await adapter.listSlugs()).toEqual(["ada-lovelace"]);
    expect(await adapter.exists("ada-lovelace")).toBe(true);

    const updated = adapter.serialize({ meta: { name: "ada-lovelace", balance: 25, active: true }, slices: [], body: "" });
    await adapter.writeRaw("ada-lovelace", updated);
    expect(adapter.parse(await adapter.readRaw("ada-lovelace")).meta).toEqual({
      name: "ada-lovelace",
      balance: 25,
      active: true,
    });
    expect(client.pages).toHaveLength(1); // update, not a second create

    await adapter.deletePublished("ada-lovelace");
    expect(await adapter.exists("ada-lovelace")).toBe(false);
    expect(await adapter.listSlugs()).toEqual([]);
    expect(client.pages[0].archived).toBe(true); // archived, not removed from the "database"

    // Deleting an already-absent slug is a no-op, not a throw.
    await expect(adapter.deletePublished("ada-lovelace")).resolves.not.toThrow();
  });

  it("throws creating a new record when no slugProperty is configured", async () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    const raw = adapter.serialize({ meta: { name: "x", balance: 0, active: false }, slices: [], body: "" });
    await expect(adapter.writeRaw("ffffffff-ffff-ffff-ffff-ffffffffffff", raw)).rejects.toThrow(/slugProperty/);
  });
});

describe("notion-adapter draft write-through", () => {
  it("aliases draft ops to published: writeDraftRaw writes through, readDraftRaw/hasDraft report no draft", async () => {
    const client = fakeClient();
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties, slugProperty: "name" });
    const raw = adapter.serialize({ meta: { name: "ada-lovelace", balance: 5, active: false }, slices: [], body: "" });

    await adapter.writeDraftRaw("ada-lovelace", raw);
    expect(await adapter.hasDraft("ada-lovelace")).toBe(false);
    expect(await adapter.readDraftRaw("ada-lovelace")).toBeNull();
    expect(await adapter.exists("ada-lovelace")).toBe(true); // the write-through already published it
    expect((adapter.parse(await adapter.readRaw("ada-lovelace"))).meta.balance).toBe(5);

    // No-op, must not throw or touch the published row it aliases.
    await expect(adapter.deleteDraft("ada-lovelace")).resolves.not.toThrow();
    expect(await adapter.exists("ada-lovelace")).toBe(true);
  });
});

describe("notion-adapter locale guard", () => {
  it("throws on an unconfigured locale, matching markdown-adapter's traversal guard", async () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    await expect(adapter.listSlugs("fr")).rejects.toThrow(/unknown locale/);
    await expect(adapter.exists("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "fr")).rejects.toThrow(/unknown locale/);
  });
});

describe("notion-adapter property type mapping", () => {
  // Neutral fixture covering every non-text property type this adapter
  // maps, unrelated to any particular site's database shape.
  const wideProperties = {
    category: { name: "Category", type: "select" as const },
    score: { name: "Score", type: "number" as const },
    state: { name: "State", type: "status" as const },
    labels: { name: "Labels", type: "multi_select" as const },
    seenAt: { name: "Seen At", type: "date" as const },
    related: { name: "Related", type: "relation" as const },
  };

  it("reads select/status/multi_select/date/relation properties off a Notion-shaped row", async () => {
    const client = fakeClient([
      {
        id: "11111111-1111-1111-1111-111111111111",
        archived: false,
        properties: {
          Category: { select: { name: "Alpha" } },
          Score: { number: -12.5 },
          State: { status: { name: "Live" } },
          Labels: { multi_select: [{ name: "red" }] },
          "Seen At": { date: { start: "2026-09-01" } },
          Related: { relation: [{ id: "row-9" }] },
        },
      },
    ], {}, "db-wide");
    const adapter = createNotionAdapter({ client, databaseId: "db-wide", properties: wideProperties });

    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta).toEqual({
      category: "Alpha",
      score: -12.5,
      state: "Live",
      labels: ["red"],
      seenAt: "2026-09-01",
      related: ["row-9"],
    });
  });

  it("writes select/status/multi_select/date/relation properties back through an update", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }], {}, "db-wide");
    const adapter = createNotionAdapter({ client, databaseId: "db-wide", properties: wideProperties });

    await adapter.writeRaw(
      "11111111-1111-1111-1111-111111111111",
      adapter.serialize({
        meta: { category: "Beta", score: 20, state: "Draft", labels: ["blue"], seenAt: null, related: [] },
        slices: [],
        body: "",
      })
    );

    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta).toEqual({
      category: "Beta",
      score: 20,
      state: "Draft",
      labels: ["blue"],
      seenAt: null,
      related: [],
    });
  });
});

describe("notion-adapter contact-shaped property types", () => {
  const contactProperties = {
    email: { name: "Email", type: "email" as const },
    phone: { name: "Phone", type: "phone_number" as const },
    site: { name: "Site", type: "url" as const },
  };

  it("round-trips email/phone_number/url and defaults each to null when absent", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: contactProperties });

    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta).toEqual({ email: null, phone: null, site: null });

    await adapter.writeRaw(
      "11111111-1111-1111-1111-111111111111",
      adapter.serialize({
        meta: { email: "a@x.test", phone: "+1 555", site: "https://x.test" },
        slices: [],
        body: "",
      })
    );
    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta).toEqual({
      email: "a@x.test",
      phone: "+1 555",
      site: "https://x.test",
    });
  });
});

describe("notion-adapter content: \"blocks\"", () => {
  const nameOnly = { name: { name: "Name", type: "title" as const } };

  it("reads body as the page's block children converted to markdown", async () => {
    const client = fakeClient(
      [{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: { Name: { title: [{ plain_text: "Doc" }] } } }],
      { "11111111-1111-1111-1111-111111111111": [{ id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "hello" }] } }] }
    );
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: nameOnly, content: "blocks" });

    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111"))).toEqual({
      meta: { name: "Doc" },
      slices: [],
      body: "hello",
    });
  });

  it("throws at construction when the client has no listBlockChildren", () => {
    expect(() =>
      createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties: nameOnly, content: "blocks" })
    ).toThrow(/listBlockChildren/);
  });

  it("warns once (not on every write) instead of silently dropping a body edit", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }], { "11111111-1111-1111-1111-111111111111": [] });
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: nameOnly, content: "blocks" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await adapter.writeRaw("11111111-1111-1111-1111-111111111111", adapter.serialize({ meta: { name: "Doc" }, slices: [], body: "edited body" }));
    await adapter.writeRaw("11111111-1111-1111-1111-111111111111", adapter.serialize({ meta: { name: "Doc 2" }, slices: [], body: "edited again" }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/content:"blocks".*not written back/);
    // The property write itself still went through.
    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta).toEqual({ name: "Doc 2" });
    warn.mockRestore();
  });
});

describe('notion-adapter content: "slices"', () => {
  const nameOnly = { name: { name: "Name", type: "title" as const } };
  // prose, then a directive, then more prose, then a directive with no props
  // and a name nothing registers, this adapter has no opinion on that,
  // see the second test below.
  const pageBlocks: NotionBlock[] = [
    { id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "intro" }] } },
    { id: "b2", type: "callout", callout: { rich_text: [{ plain_text: '::hero\n{"heading":"Hi"}' }] } },
    { id: "b3", type: "paragraph", paragraph: { rich_text: [{ plain_text: "middle" }] } },
    { id: "b4", type: "callout", callout: { rich_text: [{ plain_text: "::totally-unknown-widget" }] } },
  ];

  it("reads a page's block content as an ordered PageContent.slices, body always empty", async () => {
    const client = fakeClient(
      [{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: { Name: { title: [{ plain_text: "Doc" }] } } }],
      { "11111111-1111-1111-1111-111111111111": pageBlocks }
    );
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: nameOnly, content: "slices" });

    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111"))).toEqual({
      meta: { name: "Doc" },
      slices: [
        { slice: "prose", markdown: "intro" },
        { slice: "hero", heading: "Hi" },
        { slice: "prose", markdown: "middle" },
        { slice: "totally-unknown-widget" },
      ],
      body: "",
    });
  });

  it("passes an unregistered component name through untouched, never throwing — registry-fallback is the render layer's job (see SliceZone in templates/init.ts), not this adapter's", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }], {
      "11111111-1111-1111-1111-111111111111": [{ id: "b1", type: "callout", callout: { rich_text: [{ plain_text: "::mystery-widget" }] } }],
    });
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: nameOnly, content: "slices" });

    await expect(adapter.readRaw("11111111-1111-1111-1111-111111111111")).resolves.not.toThrow();
    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).slices).toEqual([{ slice: "mystery-widget" }]);
  });

  it("throws at construction when the client has no listBlockChildren", () => {
    expect(() =>
      createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties: nameOnly, content: "slices" })
    ).toThrow(/listBlockChildren/);
  });

  it("warns once (not on every write) instead of silently dropping slice edits; property writes still go through", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }], { "11111111-1111-1111-1111-111111111111": [] });
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: nameOnly, content: "slices" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const slices = [{ slice: "prose", markdown: "hi" }];

    await adapter.writeRaw("11111111-1111-1111-1111-111111111111", adapter.serialize({ meta: { name: "Doc" }, slices, body: "" }));
    await adapter.writeRaw("11111111-1111-1111-1111-111111111111", adapter.serialize({ meta: { name: "Doc 2" }, slices, body: "" }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/content:"slices".*not written back/);
    // The property write itself still went through.
    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta).toEqual({ name: "Doc 2" });
    warn.mockRestore();
  });

  it("does not warn writing an empty slices array — nothing would be lost", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }], { "11111111-1111-1111-1111-111111111111": [] });
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: nameOnly, content: "slices" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await adapter.writeRaw("11111111-1111-1111-1111-111111111111", adapter.serialize({ meta: { name: "Doc" }, slices: [], body: "" }));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("notion-adapter rich_text property + bodyProperty", () => {
  const noteProperties = {
    name: { name: "Name", type: "title" as const },
    summary: { name: "Summary", type: "rich_text" as const },
  };

  it("round-trips a rich_text property", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: noteProperties });

    await adapter.writeRaw(
      "11111111-1111-1111-1111-111111111111",
      adapter.serialize({ meta: { name: "n", summary: "a short summary" }, slices: [], body: "" })
    );
    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta.summary).toBe("a short summary");
  });

  it("round-trips PageContent.body through a configured bodyProperty", async () => {
    const client = fakeClient([{ id: "11111111-1111-1111-1111-111111111111", archived: false, properties: {} }]);
    const adapter = createNotionAdapter({
      client,
      databaseId: "db1",
      properties: noteProperties,
      bodyProperty: "summary",
    });

    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).body).toBe("");
    await adapter.writeRaw("11111111-1111-1111-1111-111111111111", adapter.serialize({ meta: { name: "n" }, slices: [], body: "the body text" }));
    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).body).toBe("the body text");
    // The property mapper's own type still wins over the bodyProperty default.
    expect(adapter.parse(await adapter.readRaw("11111111-1111-1111-1111-111111111111")).meta.summary).toBe("the body text");
  });
});

describe("notion-adapter listSlugs ordering", () => {
  it("sorts more than one record's slugs", async () => {
    const client = fakeClient([
      { id: "11111111-1111-1111-1111-111111111111", archived: false, properties: { Name: { title: [{ plain_text: "Zed" }] } } },
      { id: "22222222-2222-2222-2222-222222222222", archived: false, properties: { Name: { title: [{ plain_text: "Ada" }] } } },
    ]);
    const adapter = createNotionAdapter({
      client,
      databaseId: "db1",
      properties: { name: { name: "Name", type: "title" as const } },
      slugProperty: "name",
    });
    expect(await adapter.listSlugs()).toEqual(["Ada", "Zed"]);
  });
});

describe("createNotionAdapter contract", () => {
  // slugProperty is required for the contract suite's writeRaw-on-an-unknown-
  // slug round trip: without one, this adapter can only update an EXISTING
  // row (see createNotionAdapter's doc comment), which the generic suite
  // (shared with the fs/GitHub adapters, which always support creating by
  // slug) doesn't special-case.
  createContentAdapterContractSuite(
    () =>
      createNotionAdapter({
        client: fakeClient(),
        databaseId: "db-contract",
        properties: { ...properties, body: { name: "Body", type: "rich_text" as const } },
        slugProperty: "name",
        bodyProperty: "body",
      }),
    { draftsWriteThrough: true }
  );
});

describe("createFetchNotionClient transport", () => {
  it("sends the integration token as a bearer header, never in the URL", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "p1", archived: false, properties: {} }), { status: 200 });
    }) as unknown as typeof fetch;

    const page = await createFetchNotionClient("secret_notion_token", fetchImpl).retrievePage("p1");
    expect(page).toEqual({ id: "p1", archived: false, properties: {} });

    const call = calls.at(-1)!;
    expect(call.url).toBe("https://api.notion.com/v1/pages/p1");
    expect(call.url).not.toContain("secret_notion_token");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret_notion_token");
  });

  it("returns null for a 404 (page absent)", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const page = await createFetchNotionClient("secret_notion_token", fetchImpl).retrievePage("missing");
    expect(page).toBeNull();
  });
});
