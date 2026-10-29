import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageTemplate, SavedSlice } from "@typren/core";
import { PageTemplatesLibrary, SliceListEditor, sliceName } from "./page-templates";
import { TemplatesLevel } from "./site-rail";
import { TyprenStudio } from "./typren-studio";
import type { TyprenStudioHost } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const saved: SavedSlice[] = [{ id: "s1", name: "Launch hero", savedAt: "2026-10-01T12:00:00Z", slice: { slice: "hero", title: "Launch" } }];
const landing: PageTemplate = {
  id: "t1",
  name: "Landing",
  savedAt: "2026-10-01T12:00:00Z",
  slices: [{ slice: "hero" }, { slice: "cta_band", label: "Signup" }],
};

function hostWith(list: PageTemplate[] = [landing]) {
  const templates = {
    list: vi.fn(async () => list),
    save: vi.fn(async (name: string, slices: PageTemplate["slices"]) => ({ id: "t2", name, savedAt: "2026-10-02T12:00:00Z", slices })),
    update: vi.fn(async (id: string, slices: PageTemplate["slices"], _b: string, name?: string) => ({
      ok: true as const,
      saved: { id, name: name ?? "", savedAt: "2026-10-03T12:00:00Z", slices },
    })),
    remove: vi.fn(async () => {}),
  };
  const host = {
    actions: {} as PageActions,
    sliceNames: ["cta_band"],
    defaults: { cta_band: { label_text: "Go" } },
    previewPath: "/preview",
    library: { list: vi.fn(async () => saved), save: vi.fn(), update: vi.fn(), remove: vi.fn(), templates },
  } as unknown as TyprenStudioHost;
  return { host, templates };
}

const iconOf = (text: HTMLElement) => text.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
describe("sliceName", () => {
  it("prefers a slice's label, else title-cases its type", () => {
    expect(sliceName({ slice: "cta_band", label: "Signup" })).toBe("Signup");
    expect(sliceName({ slice: "cta_band" })).toBe("Cta band");
  });
});

describe("SliceListEditor", () => {
  it("reorders, removes and adds a copy of a chosen section", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const choices = [{ id: "s1", name: "Launch hero", slice: { slice: "hero", title: "Launch" } }];
    render(<SliceListEditor slices={[{ slice: "a" }, { slice: "b" }]} choices={choices} onChange={onChange} />);
    expect((screen.getByRole("button", { name: "Move A up" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Move A down" }));
    expect(onChange).toHaveBeenLastCalledWith([{ slice: "b" }, { slice: "a" }]);
    await user.click(screen.getByRole("button", { name: "Move B up" }));
    expect(onChange).toHaveBeenLastCalledWith([{ slice: "b" }, { slice: "a" }]);
    await user.click(screen.getByRole("button", { name: "Remove A" }));
    expect(onChange).toHaveBeenLastCalledWith([{ slice: "b" }]);
    await user.click(screen.getByRole("combobox", { name: "Add section" }));
    await user.click(await screen.findByRole("option", { name: "Launch hero" }));
    const added = onChange.mock.lastCall![0];
    expect(added).toEqual([{ slice: "a" }, { slice: "b" }, { slice: "hero", title: "Launch" }]);
    expect(added[2]).not.toBe(choices[0]!.slice);
  });
});

describe("TemplatesLevel", () => {
  it("lists Sections and Pages, or Sections alone without page templates", async () => {
    const onOpen = vi.fn();
    render(<TemplatesLevel current="sections" onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: /^Sections\s?\d+$/ }).getAttribute("aria-current")).toBe("page");
    await userEvent.setup().click(screen.getByRole("button", { name: /^Pages\s?\d+$/ }));
    expect(onOpen).toHaveBeenCalledWith("pages", "");
    cleanup();
    render(<TemplatesLevel current="sections" pages={false} onOpen={onOpen} />);
    expect(screen.queryByRole("button", { name: /^Pages\s?\d+$/ })).toBeNull();
  });
});

describe("TemplatesLevel folders", () => {
  function railHost() {
    const ops = () => ({ list: vi.fn(async () => ["landing", "landing/sale"]), create: vi.fn(async () => {}), rename: vi.fn(async () => {}), delete: vi.fn(async () => {}) });
    const templates = { list: vi.fn(async () => [{ ...landing, folder: "landing/sale" }]), move: vi.fn(async () => ({ ok: true })), folders: ops() };
    const library = { list: vi.fn(async () => saved), move: vi.fn(async () => ({ ok: true })), folders: { ...ops(), list: vi.fn(async () => []) }, templates };
    return { library, templates };
  }

  it("shows each kind's tree, Built-in fixed under Sections, and opens a folder in its kind", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { library } = railHost();
    render(<TemplatesLevel current="pages" folder="landing" library={library as never} builtIns={3} onOpen={onOpen} />);
    expect((await screen.findByRole("button", { name: /^Built-in\s?3$/ })).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: /^landing\s?1$/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /^Sections\s?4$/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^sale/ }));
    expect(onOpen).toHaveBeenCalledWith("pages", "landing/sale");
    await user.click(screen.getByRole("button", { name: /^Built-in/ }));
    expect(onOpen).toHaveBeenCalledWith("sections", "built-in");
  });

  it("creates a folder in the one shown, and takes drops of its own kind only", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { library, templates } = railHost();
    render(<TemplatesLevel current="pages" folder="landing" library={library as never} onOpen={vi.fn()} onChange={onChange} />);
    await user.click(await screen.findByRole("button", { name: "New folder" }));
    await user.type(screen.getByPlaceholderText("Folder in landing"), "Bad Name");
    expect(screen.getByRole("alert").textContent).toMatch(/lowercase/);
    await user.clear(screen.getByPlaceholderText("Folder in landing"));
    await user.type(screen.getByPlaceholderText("Folder in landing"), "spring{Enter}");
    await waitFor(() => expect(templates.folders.create).toHaveBeenCalledWith("landing/spring"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const row = screen.getByRole("button", { name: /^landing\s?1$/ }).closest("li")!;
    const drop = (type: string) =>
      fireEvent.drop(row, { dataTransfer: { types: [type], getData: (k: string) => (k === type ? "t1" : "") } });
    drop("application/x-typren-section");
    expect(templates.move).not.toHaveBeenCalled();
    drop("application/x-typren-template");
    await waitFor(() => expect(templates.move).toHaveBeenCalledWith("t1", "landing"));
  });
});

describe("PageTemplatesLibrary", () => {
  it("shows a blank starter then saved templates, as a gallery or a list", async () => {
    const { host } = hostWith();
    const { rerender } = render(<PageTemplatesLibrary host={host} view="gallery" />);
    expect(await screen.findByRole("option", { name: "Landing" })).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual(["New template", "Landing"]);
    expect(screen.getByRole("option", { name: "Landing" }).textContent).toContain("2 sections");
    rerender(<PageTemplatesLibrary host={host} view="list" />);
    const row = screen.getByRole("row", { name: /Landing/ });
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(expect.arrayContaining(["2 sections", "Saved"]));
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["Name", "Sections", "Updated", "Kind"]));
  });

  it("says so without page templates, and when they fail to load", async () => {
    render(<PageTemplatesLibrary host={{ sliceNames: [], defaults: {} } as unknown as TyprenStudioHost} view="gallery" />);
    expect(iconOf(screen.getByText("This studio has no page templates."))).toBeTruthy();
    cleanup();
    const { host, templates } = hostWith();
    templates.list.mockRejectedValueOnce(new Error("down"));
    render(<PageTemplatesLibrary host={host} view="gallery" />);
    expect(await screen.findByText("Couldn’t load page templates.")).toBeTruthy();
  });

  it("saves a new template from the blank one, then opens it", async () => {
    const user = userEvent.setup();
    const { host, templates } = hostWith([]);
    render(<PageTemplatesLibrary host={host} view="gallery" />);
    await user.dblClick(await screen.findByRole("option", { name: "New template" }));
    const dialog = screen.getByRole("dialog", { name: "New template" });
    const save = within(dialog).getByRole("button", { name: "Save as new template" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("Name"), "Promo");
    await user.click(within(dialog).getByRole("combobox", { name: "Add section" }));
    await user.click(await screen.findByRole("option", { name: "Cta band" }));
    templates.list.mockResolvedValue([{ id: "t2", name: "Promo", savedAt: "2026-10-02T12:00:00Z", slices: [] }]);
    await user.click(save);
    await waitFor(() => expect(templates.save).toHaveBeenCalledWith("Promo", [{ slice: "cta_band", label_text: "Go" }]));
    expect(await screen.findByRole("dialog", { name: "Promo" })).toBeTruthy();
  });

  it("edits a saved template against its savedAt, reports a conflict, starts a page and deletes", async () => {
    const user = userEvent.setup();
    const onNewPage = vi.fn();
    const { host, templates } = hostWith();
    render(<PageTemplatesLibrary host={host} view="gallery" onNewPage={onNewPage} />);
    await user.dblClick(await screen.findByRole("option", { name: "Landing" }));
    const dialog = screen.getByRole("dialog", { name: "Landing" });
    const save = within(dialog).getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Remove Hero" }));
    await user.click(save);
    await waitFor(() => expect(templates.update).toHaveBeenCalledWith("t1", [{ slice: "cta_band", label: "Signup" }], landing.savedAt, "Landing"));
    expect(await within(dialog).findByText("Saved")).toBeTruthy();

    templates.update.mockResolvedValueOnce({ ok: false, code: "conflict" } as never);
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText(/changed elsewhere/)).toBeTruthy();
    templates.update.mockResolvedValueOnce({ ok: false, code: "missing" } as never);
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText("This template was deleted.")).toBeTruthy();
    templates.update.mockRejectedValueOnce(new Error("disk full"));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText("Save failed: disk full")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: /New page from template/ }));
    expect(onNewPage).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", slices: [{ slice: "cta_band", label: "Signup" }] }));

    await user.click(within(dialog).getByRole("button", { name: /Delete template/ }));
    expect(within(await screen.findByRole("alertdialog")).getByText("Delete the page template “Landing”?")).toBeTruthy();
    await answer("Delete");
    await waitFor(() => expect(templates.remove).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("TyprenStudio Templates", () => {
  const sections = [
    { kind: "pages", label: "Pages" },
    { kind: "library", id: "templates", label: "Templates" },
  ] as TyprenStudioHost["sections"];

  it("drills into Sections and Pages, and opens the wizard from a page template", async () => {
    const user = userEvent.setup();
    const { host } = hostWith();
    render(<TyprenStudio host={{ ...host, sections }} pages={[]} sectionId="templates" onNavigate={vi.fn()} onReload={vi.fn()} />);
    expect((await screen.findByRole("button", { name: /^Sections\s?\d+$/ })).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("option", { name: "Launch hero" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Pages\s?\d+$/ }));
    await user.dblClick(await screen.findByRole("option", { name: "Landing" }));
    await user.click(screen.getByRole("button", { name: /New page from template/ }));
    const wizard = await screen.findByRole("dialog", { name: "What’s this page called?" });
    expect(within(wizard).getByRole("progressbar").getAttribute("aria-valuetext")).toBe("Step 1 of 5");
  });

  it("follows the host's templatesView and reports a switch", async () => {
    const user = userEvent.setup();
    const onNavigateTemplatesView = vi.fn();
    const { host } = hostWith();
    render(
      <TyprenStudio
        host={{ ...host, sections }}
        pages={[]}
        sectionId="templates"
        templatesView="pages"
        onNavigateTemplatesView={onNavigateTemplatesView}
        onNavigate={vi.fn()}
        onReload={vi.fn()}
      />
    );
    expect((await screen.findByRole("button", { name: /^Pages\s?\d+$/ })).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("option", { name: "Landing" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Sections\s?\d+$/ }));
    expect(onNavigateTemplatesView).toHaveBeenCalledWith("sections");
  });

  it("saves a page as a template from its settings", async () => {
    const user = userEvent.setup();
    const { host, templates } = hostWith();
    const getPage = vi.fn(async () => ({ page: { meta: { title: "About" }, slices: [{ slice: "hero" }], body: "" }, version: "v1" }));
    const pages = [{ slug: "about", title: "About", hasDraft: true, locales: ["en"] }];
    render(<TyprenStudio host={{ ...host, sections, getPage }} pages={pages} sectionId="pages" onNavigate={vi.fn()} onReload={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Settings for About" }));
    await user.click(await screen.findByRole("button", { name: "Save as page template" }));
    await user.type(screen.getByLabelText("Template name"), "{Enter}");
    await waitFor(() => expect(templates.save).toHaveBeenCalledWith("About", [{ slice: "hero" }]));
  });
});
