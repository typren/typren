import { describe, it, expect } from "vitest";
import { createNotionAdapter, type NotionClient, type NotionPage } from "./notion-adapter";

/** Hand-rolled in-memory `NotionClient`: no network, no mocking library —
 *  same spirit as markdown-adapter.test.ts using a real temp dir instead of
 *  mocking `node:fs`. */
function fakeClient(seed: NotionPage[] = []): NotionClient & { pages: NotionPage[] } {
  const pages = [...seed];
  let nextId = 1;
  return {
    pages,
    queryDatabase: () => pages.filter((p) => !p.archived),
    retrievePage: (id) => pages.find((p) => p.id === id) ?? null,
    createPage: (_databaseId, properties) => {
      const page: NotionPage = { id: `page-${nextId++}`, archived: false, properties: { ...properties } };
      pages.push(page);
      return page;
    },
    updatePage: (id, properties) => {
      const page = pages.find((p) => p.id === id);
      if (!page) throw new Error(`no such page ${id}`);
      Object.assign(page.properties, properties);
      return page;
    },
    archivePage: (id) => {
      const page = pages.find((p) => p.id === id);
      if (page) page.archived = true;
    },
  };
}

const properties = {
  name: { name: "Name", type: "title" as const },
  balance: { name: "Balance", type: "number" as const },
  active: { name: "Active", type: "checkbox" as const },
};

describe("notion-adapter list/read", () => {
  it("lists and reads records keyed by page id when no slugProperty is set", () => {
    const client = fakeClient([
      {
        id: "abc",
        archived: false,
        properties: {
          Name: { title: [{ plain_text: "Ada Lovelace" }] },
          Balance: { number: 42 },
          Active: { checkbox: true },
        },
      },
    ]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties });

    expect(adapter.listSlugs()).toEqual(["abc"]);
    expect(adapter.exists("abc")).toBe(true);
    expect(adapter.exists("missing")).toBe(false);
    expect(adapter.listLocales("abc")).toEqual(["en"]);
    expect(adapter.listLocales("missing")).toEqual([]);

    const parsed = adapter.parse(adapter.readRaw("abc"));
    expect(parsed).toEqual({ meta: { name: "Ada Lovelace", balance: 42, active: true }, slices: [], body: "" });
  });

  it("throws reading a slug that doesn't exist", () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    expect(() => adapter.readRaw("nope")).toThrow(/not found/);
  });

  it("excludes archived rows from listSlugs/exists", () => {
    const client = fakeClient([{ id: "abc", archived: true, properties: {} }]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties });
    expect(adapter.listSlugs()).toEqual([]);
    expect(adapter.exists("abc")).toBe(false);
  });

  it("throws loud on a property-type mismatch against a real Notion response", () => {
    const client = fakeClient([{ id: "abc", archived: false, properties: { Balance: { type: "select", select: null } } }]);
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties: { balance: properties.balance } });
    expect(() => adapter.readRaw("abc")).toThrow(/expected type "number" but got "select"/);
  });
});

describe("notion-adapter write/delete round-trip", () => {
  it("creates a new record via slugProperty, updates it, then deletes (archives) it", () => {
    const client = fakeClient();
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties, slugProperty: "name" });

    const raw = adapter.serialize({ meta: { name: "ada-lovelace", balance: 10, active: false }, slices: [], body: "" });
    adapter.writeRaw("ada-lovelace", raw);
    expect(adapter.listSlugs()).toEqual(["ada-lovelace"]);
    expect(adapter.exists("ada-lovelace")).toBe(true);

    const updated = adapter.serialize({ meta: { name: "ada-lovelace", balance: 25, active: true }, slices: [], body: "" });
    adapter.writeRaw("ada-lovelace", updated);
    expect(adapter.parse(adapter.readRaw("ada-lovelace")).meta).toEqual({
      name: "ada-lovelace",
      balance: 25,
      active: true,
    });
    expect(client.pages).toHaveLength(1); // update, not a second create

    adapter.deletePublished("ada-lovelace");
    expect(adapter.exists("ada-lovelace")).toBe(false);
    expect(adapter.listSlugs()).toEqual([]);
    expect(client.pages[0].archived).toBe(true); // archived, not removed from the "database"

    // Deleting an already-absent slug is a no-op, not a throw.
    expect(() => adapter.deletePublished("ada-lovelace")).not.toThrow();
  });

  it("throws creating a new record when no slugProperty is configured", () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    const raw = adapter.serialize({ meta: { name: "x", balance: 0, active: false }, slices: [], body: "" });
    expect(() => adapter.writeRaw("some-slug", raw)).toThrow(/slugProperty/);
  });
});

describe("notion-adapter draft write-through", () => {
  it("aliases draft ops to published: writeDraftRaw writes through, readDraftRaw/hasDraft report no draft", () => {
    const client = fakeClient();
    const adapter = createNotionAdapter({ client, databaseId: "db1", properties, slugProperty: "name" });
    const raw = adapter.serialize({ meta: { name: "ada-lovelace", balance: 5, active: false }, slices: [], body: "" });

    adapter.writeDraftRaw("ada-lovelace", raw);
    expect(adapter.hasDraft("ada-lovelace")).toBe(false);
    expect(adapter.readDraftRaw("ada-lovelace")).toBeNull();
    expect(adapter.exists("ada-lovelace")).toBe(true); // the write-through already published it
    expect(adapter.parse(adapter.readRaw("ada-lovelace")).meta.balance).toBe(5);

    // No-op, must not throw or touch the published row it aliases.
    expect(() => adapter.deleteDraft("ada-lovelace")).not.toThrow();
    expect(adapter.exists("ada-lovelace")).toBe(true);
  });
});

describe("notion-adapter locale guard", () => {
  it("throws on an unconfigured locale, matching markdown-adapter's traversal guard", () => {
    const adapter = createNotionAdapter({ client: fakeClient(), databaseId: "db1", properties });
    expect(() => adapter.listSlugs("fr")).toThrow(/unknown locale/);
    expect(() => adapter.exists("abc", "fr")).toThrow(/unknown locale/);
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

  it("reads select/status/multi_select/date/relation properties off a Notion-shaped row", () => {
    const client = fakeClient([
      {
        id: "row-1",
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
    ]);
    const adapter = createNotionAdapter({ client, databaseId: "db-wide", properties: wideProperties });

    expect(adapter.parse(adapter.readRaw("row-1")).meta).toEqual({
      category: "Alpha",
      score: -12.5,
      state: "Live",
      labels: ["red"],
      seenAt: "2026-09-01",
      related: ["row-9"],
    });
  });

  it("writes select/status/multi_select/date/relation properties back through an update", () => {
    const client = fakeClient([{ id: "row-1", archived: false, properties: {} }]);
    const adapter = createNotionAdapter({ client, databaseId: "db-wide", properties: wideProperties });

    adapter.writeRaw(
      "row-1",
      adapter.serialize({
        meta: { category: "Beta", score: 20, state: "Draft", labels: ["blue"], seenAt: null, related: [] },
        slices: [],
        body: "",
      })
    );

    expect(adapter.parse(adapter.readRaw("row-1")).meta).toEqual({
      category: "Beta",
      score: 20,
      state: "Draft",
      labels: ["blue"],
      seenAt: null,
      related: [],
    });
  });
});
