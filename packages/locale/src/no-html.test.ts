import { describe, expect, it, vi } from "vitest";
import { createNodePurifier } from "./build/node-purifier";
import { assertNoHtml, isUnsafeHtml } from "./no-html";
import type { Catalog } from "./types";

// Every payload here slipped past (or would slip past) a tag/handler denylist: handler names nobody
// listed, entity- or control-character-spelled schemes, and harmless-looking tags that retarget URLs.
const BYPASSES = [
  "<script>alert(1)</script>",
  '<a onclick="evil()">here</a>',
  '<a href="javascript:evil()">terms</a>',
  "<details open ontoggle=alert(1)>",
  '<div oncontentvisibilityautostatechange="alert(1)" style="content-visibility:auto">x</div>',
  "<p onpointerrawupdate=alert(1)>x</p>",
  "<span onwebkitanimationend=alert(1)>x</span>",
  "<span onwebkitanimationstart=alert(1)>x</span>",
  "<button popovertarget=x>x</button><div popover id=x onbeforetoggle=alert(1)>x</div>",
  "<p onbeforetoggle=alert(1)>x</p>",
  "<div onscrollend=alert(1) style=overflow:auto>x</div>",
  '<a href="javascript&colon;alert(1)">x</a>',
  '<a href="java&Tab;script:alert(1)">x</a>',
  '<a href="java\0script:alert(1)">x</a>',
  '<a href="jav&#x09;ascript:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#0000106avascript:alert(1)">x</a>',
  '<base href="https://evil.example/">',
  '<form action="https://evil.example/"><input name=q></form>',
  '<button formaction="javascript:alert(1)">go</button>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="/terms" target="_blank">x</a>',
  '<img src=x onerror="alert(1)">',
  "<svg><animate onbegin=alert(1)></svg>",
  "<body onload=alert(1)>x",
  "<remove>x</remove><remove></remove>",
];

const ALLOWED = [
  "Hi {name}, you have {count} messages",
  '<a href="/terms">terms</a>',
  '<a href="https://x.example/path?q=1#top" title="Terms">x</a>',
  '<a href="mailto:help@example.com">mail us</a>',
  '<a href="/go?convenioId=133">continue</a>',
  '<a href="terms.html">terms</a>',
  "<b>bold</b> and <p><ul><li>a list</li></ul></p>",
  "<strong>x</strong> <em>y</em> <i>z</i> <code>a</code> <span>b</span><br><h3>c</h3><ol><li>d</li></ol>",
  "Tom & Jerry, 1 < 2",
];

describe("assertNoHtml", () => {
  it.each(BYPASSES)("rejects %j", (payload) => {
    expect(() => assertNoHtml({ Copy: { Body: payload } })).toThrow(/Copy\.Body/);
  });

  it.each(ALLOWED)("passes allowed copy %j", (value) => {
    expect(() => assertNoHtml({ Copy: { Body: value } })).not.toThrow();
  });

  it("lists every offending dot-path when there are multiple", () => {
    const catalog: Catalog = {
      A: { Bad: "<script>x</script>" },
      B: { Bad: '<img onerror="x()">' },
      C: { Ok: "fine" },
    };
    expect(() => assertNoHtml(catalog, { label: "app/en" })).toThrow(/in app\/en at: A\.Bad, B\.Bad$/);
  });

  it("fails closed without a DOM instead of passing everything through", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    try {
      const fresh = await import("./no-html");
      expect(() => fresh.assertNoHtml({ A: "plain" })).toThrow(/no DOM available/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the jsdom purifier for Node applies the same gate", () => {
    const purifier = createNodePurifier();
    expect(createNodePurifier()).toBe(purifier);
    expect(isUnsafeHtml("<p onscrollend=alert(1)>x</p>", purifier)).toBe(true);
    expect(isUnsafeHtml('<a href="/terms">terms</a>', purifier)).toBe(false);
  });
});
