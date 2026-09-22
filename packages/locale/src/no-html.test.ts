import { describe, expect, it } from "vitest";
import { assertNoHtml } from "./no-html";
import type { Catalog } from "./types";

describe("assertNoHtml", () => {
  it("throws and names the key for a dangerous tag", () => {
    const catalog: Catalog = { Greeting: { Hello: "<script>alert(1)</script>" } };
    expect(() => assertNoHtml(catalog)).toThrow(/Greeting\.Hello/);
  });

  it("throws and names the key for an inline event handler", () => {
    const catalog: Catalog = { Button: { Label: 'click <a onclick="evil()">here</a>' } };
    expect(() => assertNoHtml(catalog)).toThrow(/Button\.Label/);
  });

  it("throws and names the key for a javascript: URI, even inside an <a> href", () => {
    const catalog: Catalog = { Terms: { Link: '<a href="javascript:evil()">terms</a>' } };
    expect(() => assertNoHtml(catalog)).toThrow(/Terms\.Link/);
  });

  it("rejects ontoggle (script-less <details> vector)", () => {
    const catalog: Catalog = { A: "<details open ontoggle=alert(1)>" };
    expect(() => assertNoHtml(catalog)).toThrow(/at: A/);
  });

  it("rejects pointer-event handlers", () => {
    const catalog: Catalog = { A: "<img src=x onpointerover=alert(1)>" };
    expect(() => assertNoHtml(catalog)).toThrow(/at: A/);
  });

  it("rejects a javascript: URI hidden behind an entity-encoded tab", () => {
    const catalog: Catalog = { A: '<a href="jav&#x09;ascript:alert(1)">x</a>' };
    expect(() => assertNoHtml(catalog)).toThrow(/at: A/);
  });

  it("rejects a javascript: URI whose first letter is entity-encoded", () => {
    const catalog: Catalog = { A: '<a href="&#106;avascript:alert(1)">x</a>' };
    expect(() => assertNoHtml(catalog)).toThrow(/at: A/);
  });

  it("rejects decimal entities with leading zeros and no semicolon", () => {
    const catalog: Catalog = { A: '<a href="&#0000106avascript:alert(1)">x</a>' };
    expect(() => assertNoHtml(catalog)).toThrow(/at: A/);
  });

  it("does not false-flag a benign query param that looks like a bare on\\w+=", () => {
    // Regression guard for the denylist design: a naive `on\w+=` pattern
    // would misfire on ordinary query-string copy like this.
    const catalog: Catalog = { Promo: { Link: '<a href="/go?convenioId=133">continue</a>' } };
    expect(() => assertNoHtml(catalog)).not.toThrow();
  });

  it("passes a plain catalog with {var} placeholders", () => {
    const catalog: Catalog = { Greeting: { Hello: "Hi {name}, you have {count} messages" } };
    expect(() => assertNoHtml(catalog)).not.toThrow();
  });

  it("passes a benign <a href> link", () => {
    const catalog: Catalog = { Terms: { Link: '<a href="/terms">terms</a>' } };
    expect(() => assertNoHtml(catalog)).not.toThrow();
  });

  it("passes a benign https link", () => {
    const catalog: Catalog = { Terms: { Link: '<a href="https://x">x</a>' } };
    expect(() => assertNoHtml(catalog)).not.toThrow();
  });

  it("passes safe formatting tags", () => {
    const catalog: Catalog = { Notice: { Body: "<b>bold</b> and <p><ul><li>a list</li></ul></p>" } };
    expect(() => assertNoHtml(catalog)).not.toThrow();
  });

  it("lists every offending dot-path when there are multiple", () => {
    const catalog: Catalog = {
      A: { Bad: "<script>x</script>" },
      B: { Bad: '<img onerror="x()">' },
      C: { Ok: "fine" },
    };
    expect(() => assertNoHtml(catalog)).toThrow(/A\.Bad.*B\.Bad|B\.Bad.*A\.Bad/s);
  });
});
