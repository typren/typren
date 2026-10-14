import { describe, it, expect } from "vitest";
import { generateLlmsFullTxt } from "./llms-txt";
import { fakeStore } from "./test-fixtures";

describe("generateLlmsFullTxt", () => {
  it("renders every page as a titled, flattened section, joined by a rule", async () => {
    const store = fakeStore([
      { slug: "home", meta: { title: "Home" }, slices: [{ slice: "hero", heading: "Welcome" }] },
      { slug: "about", slices: [{ slice: "hero", heading: "About us" }] },
    ]);
    expect(await generateLlmsFullTxt(store)).toBe("# Home\n\nWelcome\n\n---\n\n# about\n\nAbout us");
  });

  it("falls back to the slug when a page has no title", async () => {
    const store = fakeStore([{ slug: "untitled", slices: [] }]);
    expect(await generateLlmsFullTxt(store)).toBe("# untitled\n\n");
  });

  it("uses listSlugs, not listPages (no hasDraft/listLocales fan-out)", async () => {
    const store = fakeStore([{ slug: "about" }]);
    await generateLlmsFullTxt(store);
    expect(store.listPagesCalls).toBe(0);
  });
});
