import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSections } from "@typren/core";
import type { PageActions, PageInfo, Section } from "@typren/core";
import { SectionShell } from "./section-shell";
import type { TyprenEditorHost } from "./types";

afterEach(cleanup);

const actions = {
  createPage: vi.fn(async (title: string) => title),
  deletePage: vi.fn(async () => {}),
  saveDraft: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  publish: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  discardDraft: vi.fn(async () => {}),
} as unknown as PageActions;

const pages: PageInfo[] = [{ slug: "home", title: "Home", hasDraft: false, locales: ["en"] }];

function makeHost(sections: Section[]): TyprenEditorHost {
  return { actions, sliceNames: [], defaults: {}, previewPath: "/preview", sections };
}

describe("SectionShell", () => {
  it("renders SectionNav plus the Pages picker for the default section trio", () => {
    const sections: Section[] = [
      { kind: "pages", label: "Pages" },
      { kind: "media", label: "Media" },
      { kind: "settings", label: "Settings" },
    ];
    render(
      <SectionShell
        host={makeHost(sections)}
        sections={resolveSections({ sections })}
        activeId="pages"
        onSelectSection={() => {}}
        pages={pages}
        onNavigatePage={() => {}}
        onReload={() => {}}
      />
    );
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy(); // PageList row
  });

  it("clicking a rail row reports the section id via onSelectSection, not a route", async () => {
    const sections: Section[] = [
      { kind: "pages", label: "Pages" },
      { kind: "media", label: "Media" },
    ];
    const onSelectSection = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionShell
        host={makeHost(sections)}
        sections={resolveSections({ sections })}
        activeId="pages"
        onSelectSection={onSelectSection}
        pages={pages}
        onNavigatePage={() => {}}
        onReload={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: "Media" }));
    expect(onSelectSection).toHaveBeenCalledWith("media");
  });

  it("falls back to the first resolved section when activeId doesn't match any", () => {
    const sections: Section[] = [{ kind: "settings", label: "Settings" }];
    render(
      <SectionShell
        host={makeHost(sections)}
        sections={resolveSections({ sections })}
        activeId="nonexistent"
        onSelectSection={() => {}}
        pages={pages}
        onNavigatePage={() => {}}
        onReload={() => {}}
      />
    );
    expect(screen.getByText(/aren.t configured/)).toBeTruthy(); // Settings section, no `host.settings`
  });

  it("renders a collection section's records from `collectionRecords`, keyed by section id", () => {
    const sections: Section[] = [{ kind: "collection", id: "authors", label: "Authors", dir: "content/authors", schema: { name: { type: "text" } } }];
    render(
      <SectionShell
        host={makeHost(sections)}
        sections={resolveSections({ sections })}
        activeId="authors"
        onSelectSection={() => {}}
        pages={pages}
        onNavigatePage={() => {}}
        onReload={() => {}}
        collectionRecords={{ authors: [{ slug: "ada", meta: { name: "Ada Lovelace" }, body: "", hasDraft: false }] }}
      />
    );
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("passes collectionMode/collectionSlug/onNavigateCollection through to CollectionPanel", async () => {
    const sections: Section[] = [{ kind: "collection", id: "authors", label: "Authors", dir: "content/authors", schema: { name: { type: "text" } } }];
    const onNavigateCollection = vi.fn();
    const user = userEvent.setup();
    render(
      <SectionShell
        host={makeHost(sections)}
        sections={resolveSections({ sections })}
        activeId="authors"
        onSelectSection={() => {}}
        pages={pages}
        onNavigatePage={() => {}}
        onReload={() => {}}
        collectionRecords={{ authors: [{ slug: "ada", meta: { name: "Ada Lovelace" }, body: "", hasDraft: false }] }}
        collectionMode="edit"
        collectionSlug="ada"
        onNavigateCollection={onNavigateCollection}
      />
    );
    // controlled straight into the edit form, not the list
    expect(screen.getByDisplayValue("Ada Lovelace")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onNavigateCollection).toHaveBeenCalledWith("list", undefined);
  });

  it("a custom section renders a plain notice — no plugin runtime here", () => {
    const sections: Section[] = [{ kind: "custom", label: "Analytics", element: "my-analytics" }];
    render(
      <SectionShell
        host={makeHost(sections)}
        sections={resolveSections({ sections })}
        activeId="analytics"
        onSelectSection={() => {}}
        pages={pages}
        onNavigatePage={() => {}}
        onReload={() => {}}
      />
    );
    expect(screen.getByText(/custom section/)).toBeTruthy();
  });
});
