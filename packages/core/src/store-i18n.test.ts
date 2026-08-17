import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMarkdownAdapter } from "./markdown-adapter";
import { createStore } from "./store";

let dir: string;
let contentDir: string;

const enHome = `---
title: Home
description: English description
slices:
  - slice: hero
    heading: Hello
---
`;
// es overrides only the title; leaves description to fall back; carries its own slices.
const esHome = `---
title: Hola
slices:
  - slice: hero
    heading: Hola mundo
---
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-i18n-"));
  contentDir = path.join(dir, "content");
  fs.mkdirSync(path.join(contentDir, "es"), { recursive: true });
  fs.writeFileSync(path.join(contentDir, "home.md"), enHome); // default = flat
  fs.writeFileSync(path.join(contentDir, "about.md"), enHome); // only in en
  fs.writeFileSync(path.join(contentDir, "es", "home.md"), esHome);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const make = () =>
  createStore(
    createMarkdownAdapter({ contentDir, locales: ["en", "es"], defaultLocale: "en" }),
    { defaultLocale: "en" }
  );

describe("locale-aware read + fallback", () => {
  it("field-merges a present translation over the default (title overridden, description inherited)", () => {
    const p = make().getPublished("home", "es");
    expect(p.locale).toBe("es");
    expect(p.isFallback).toBe(false);
    expect(p.meta.title).toBe("Hola"); // overridden
    expect(p.meta.description).toBe("English description"); // inherited via field-level fallback
    expect(p.slices[0].heading).toBe("Hola mundo"); // locale's own slices
  });

  it("page-level fallback: an untranslated page serves the default with isFallback=true", () => {
    const p = make().getPublished("about", "es");
    expect(p.isFallback).toBe(true);
    expect(p.meta.title).toBe("Home");
    expect(p.slices[0].heading).toBe("Hello");
  });

  it("default locale is never a fallback", () => {
    const p = make().getPublished("home", "en");
    expect(p.isFallback).toBe(false);
    expect(p.meta.title).toBe("Home");
  });

  it("listLocales / PageInfo.locales report translation status", () => {
    const rows = make().listPages("en");
    expect(rows.find((r) => r.slug === "home")!.locales.sort()).toEqual(["en", "es"]);
    expect(rows.find((r) => r.slug === "about")!.locales).toEqual(["en"]);
  });
});

describe("createTranslation", () => {
  it("seeds a DRAFT (not published) in the target locale from the default content", () => {
    const store = make();
    store.createTranslation("about", "en", "es");
    expect(store.getDraft("about", "es")!.slices[0].heading).toBe("Hello");
    // Still not published in es → still a fallback read until published.
    expect(store.getPublished("about", "es").isFallback).toBe(true);
    // File landed under the es locale dir's drafts, not flat.
    expect(fs.existsSync(path.join(contentDir, "es", ".drafts", "about.md"))).toBe(true);
  });

  it("is a no-op when the target already has content or a draft", () => {
    const store = make();
    store.createTranslation("home", "en", "es"); // es/home.md already published
    expect(store.getDraft("home", "es")).toBeNull();
  });
});

describe("deleteTranslation / deletePage", () => {
  it("deleteTranslation drops one locale only", () => {
    const store = make();
    store.deleteTranslation("home", "es");
    expect(store.getPublished("home", "es").isFallback).toBe(true); // es gone → fallback
    expect(store.getPublished("home", "en").meta.title).toBe("Home"); // en intact
  });

  it("deletePage drops every locale", () => {
    const store = make();
    store.deletePage("home");
    expect(fs.existsSync(path.join(contentDir, "home.md"))).toBe(false);
    expect(fs.existsSync(path.join(contentDir, "es", "home.md"))).toBe(false);
  });
});

describe("locale allowlist guard (traversal boundary)", () => {
  it("throws on an unknown locale rather than building an out-of-allowlist path", () => {
    const adapter = createMarkdownAdapter({ contentDir, locales: ["en", "es"], defaultLocale: "en" });
    expect(() => adapter.readRaw("home", "de")).toThrow(/unknown locale/);
    expect(() => adapter.exists("home", "../../etc")).toThrow(/unknown locale/);
  });
});
