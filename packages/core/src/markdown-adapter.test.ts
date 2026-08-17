import { describe, expect, it } from "vitest";
import { createMarkdownAdapter } from "./markdown-adapter";

// parse/serialize are pure string transforms — no fs touched — so a throwaway
// contentDir (never read) is enough to construct the adapter.
const adapter = createMarkdownAdapter({ contentDir: "/unused" });

describe("markdown-adapter parse/serialize", () => {
  // Every other fixture in this repo pre-writes `slices: []`, so this gap —
  // a file with real frontmatter + a real body but no slices key at all —
  // has never been exercised. `parse` must still default slices to [] rather
  // than throw or drop the rest of the frontmatter/body.
  it("round-trips a file that has frontmatter + a body and no slices key", () => {
    const raw = "---\ntitle: Ada Lovelace\nrole: Mathematician\n---\nAda wrote the first published algorithm.\n";

    const parsed = adapter.parse(raw);
    expect(parsed).toEqual({
      meta: { title: "Ada Lovelace", role: "Mathematician" },
      slices: [],
      body: "Ada wrote the first published algorithm.\n",
    });

    const serialized = adapter.serialize(parsed);
    expect(adapter.parse(serialized)).toEqual(parsed);
  });
});
