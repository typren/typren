import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageContent, PageInfo, SavedSlice } from "@typren/core";
import { SectionsLibrary, SlicePreview, SliceSketch, libraryEntries, acquireFrame, probeSectionRoute, sliceKey } from "./sections-library";
import { TyprenStudio } from "./typren-studio";
import { useViewSlide, type AssetView } from "./asset-browser";
import type { TyprenStudioHost } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const saved: SavedSlice[] = [{ id: "s1", name: "Launch hero", savedAt: "2026-10-01T12:00:00Z", slice: { slice: "hero", title: "Launch day" } }];
const pages: PageInfo[] = [{ slug: "about", title: "About", hasDraft: false, locales: ["en"] }];
const about: PageContent = { meta: { title: "About" }, slices: [{ slice: "intro", label: "Intro" }, { slice: "outro" }], body: "" };

function mount({ view = "gallery" as AssetView, failList = false, readPage = true, getPage = false, list = saved, folder = "" } = {}) {
  const library = {
    list: vi.fn(async () => (failList ? Promise.reject(new Error("down")) : list)),
    move: vi.fn(async () => ({ ok: true })),
    folders: { list: vi.fn(async () => ["promo"]), create: vi.fn(), rename: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    save: vi.fn(async (name: string, slice: SavedSlice["slice"]) => ({ id: "new", name, savedAt: "2026-10-02T12:00:00Z", slice })),
    update: vi.fn(),
    remove: vi.fn(async () => {}),
  };
  const insertSection = vi.fn(async () => ({ ok: true as const, version: "v2" }));
  const host = {
    actions: { insertSection } as unknown as PageActions,
    sliceNames: ["cta_band", "quote"],
    defaults: { cta_band: { label_text: "Go" } },
    fieldSchema: { hero: { title: { type: "text" } } },
    previewPath: "/preview",
    library,
    readPage: readPage ? vi.fn(async () => structuredClone(about)) : undefined,
    getPage: getPage ? vi.fn(async () => ({ page: structuredClone(about), version: "v1" })) : undefined,
  } as unknown as TyprenStudioHost;
  const onOpenPage = vi.fn();
  const onInserted = vi.fn();
  // Stands in for the shell, which owns the folder shown.
  function Harness() {
    const [at, setAt] = useState(folder);
    return <SectionsLibrary host={host} pages={pages} view={view} locale="en" folder={at} onOpenFolder={setAt} onOpenPage={onOpenPage} onInserted={onInserted} />;
  }
  render(<Harness />);
  return { library, insertSection, host, onOpenPage, onInserted };
}

const item = (name: string) => screen.getByRole(screen.queryByRole("listbox", { hidden: true }) ? "option" : "row", { name: new RegExp(name), hidden: true });

describe("libraryEntries", () => {
  it("lists saved slices, then each slice type with its defaults as a built-in", () => {
    expect(libraryEntries(saved, ["cta_band"], { cta_band: { text: "Go" } })).toEqual([
      saved[0],
      { id: "builtin:cta_band", name: "Cta band", slice: { slice: "cta_band", text: "Go" }, folder: "built-in" },
    ]);
  });
});

describe("SliceSketch", () => {
  it("shows the type and the slice's texts, skipping media and links, with a bar per other field", () => {
    const { container } = render(
      <SliceSketch slice={{ slice: "hero", title: "**Hi**", sub: "There", img: "/a.webp", n: 3, logo: "x" }} schema={{ logo: { type: "image" } }} />
    );
    expect(container.textContent).toBe("heroHiThere");
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(3);
  });
});

describe("SectionsLibrary", () => {
  it("shows folders, then saved sections, with the built-ins in their own folder", async () => {
    mount();
    const hero = await screen.findByRole("option", { name: "Launch hero" });
    expect(hero.textContent).toMatch(/Oct 2026/);
    const names = screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"));
    expect(names).toEqual(["Built-in", "promo", "Launch hero"]);
    expect(screen.queryByRole("option", { name: "Cta band" })).toBeNull();
    fireEvent.doubleClick(screen.getByRole("option", { name: "Built-in" }));
    expect((await screen.findByRole("option", { name: "Cta band" })).textContent).toContain("Built-in");
    expect(screen.getByRole("button", { name: "Built-in" }).getAttribute("aria-current")).toBe("location");
  });

  it("moves a saved section from its hover pill or by dropping it on a folder, never into Built-in", async () => {
    const user = userEvent.setup();
    const { library } = mount();
    await screen.findByRole("option", { name: "Launch hero" });
    await user.click(screen.getByRole("combobox", { name: "Move Launch hero" }));
    expect(screen.queryByRole("option", { name: "built-in" })).toBeNull();
    // The menu's option renders after the tile's, once the popup opens.
    await waitFor(() => expect(screen.getAllByRole("option", { name: "promo" })).toHaveLength(2));
    await user.click(screen.getAllByRole("option", { name: "promo" }).at(-1)!);
    await waitFor(() => expect(library.move).toHaveBeenCalledWith("s1", "promo", saved[0]!.savedAt));
    const data = new Map<string, string>();
    const dataTransfer = { types: ["application/x-typren-section"], setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "" };
    fireEvent.dragStart(screen.getByRole("option", { name: "Launch hero" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("option", { name: "Built-in" }), { dataTransfer });
    expect(library.move).toHaveBeenCalledTimes(1);
    fireEvent.drop(screen.getByRole("option", { name: "promo" }), { dataTransfer });
    await waitFor(() => expect(library.move).toHaveBeenCalledTimes(2));
  });

  it("renames a saved section in place, and a folder, but never Built-in", async () => {
    const { library } = mount();
    library.update.mockResolvedValue({ ok: true });
    const hero = await screen.findByRole("option", { name: "Launch hero" });
    fireEvent.doubleClick(within(hero).getByText("Launch hero"));
    const field = screen.getByRole("textbox", { name: "Rename Launch hero" });
    field.textContent = "Big hero";
    fireEvent.keyDown(field, { key: "Enter" });
    expect(library.update).toHaveBeenCalledWith("s1", saved[0]!.slice, saved[0]!.savedAt, "Big hero");
    fireEvent.doubleClick(within(screen.getByRole("option", { name: "promo" })).getByText("promo"));
    const folder = screen.getByRole("textbox", { name: "Rename promo" });
    folder.textContent = "sale";
    fireEvent.keyDown(folder, { key: "Enter" });
    await waitFor(() => expect(library.folders.rename).toHaveBeenCalledWith("promo", "sale"));
    // Built-in's name opens it on a double click instead of renaming.
    fireEvent.doubleClick(within(screen.getByRole("option", { name: "Built-in" })).getByText("Built-in"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(await screen.findByRole("option", { name: "Cta band" })).toBeTruthy();
  });

  it("lists name, slice type and saved date in the list view", async () => {
    mount({ view: "list" });
    const row = await screen.findByRole("row", { name: /Launch hero/ });
    expect(within(row).getByText("hero")).toBeTruthy();
    expect(screen.getByText("Slice type")).toBeTruthy();
  });

  it("says so when the saved list can't load, and still shows the built-ins", async () => {
    mount({ failList: true });
    expect(await screen.findByText("Couldn’t load saved sections.")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Built-in" })).toBeTruthy();
  });

  it("shows how to save one when there is nothing at all", async () => {
    const library = { list: vi.fn(async () => []), save: vi.fn(), remove: vi.fn() };
    render(<SectionsLibrary host={{ library, sliceNames: [], defaults: {} } as unknown as TyprenStudioHost} pages={[]} view="gallery" />);
    expect(await screen.findByText(/heart button/)).toBeTruthy();
  });

  it("selects on click, Space shows Quick Look, Enter opens the viewer, arrows step", async () => {
    mount();
    const hero = await screen.findByRole("option", { name: "Launch hero" });
    fireEvent.click(hero);
    expect(hero.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(hero, { key: " " });
    expect(screen.getByRole("dialog", { name: "Quick Look: Launch hero" })).toBeTruthy();
    expect(screen.queryByText("Properties")).toBeNull();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(hero, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Launch hero" })).toBeTruthy();
    expect(screen.getByText("Properties")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
  });

  it("steps through the open item's folder in the viewer", async () => {
    mount({ folder: "built-in" });
    fireEvent.click(await screen.findByRole("option", { name: "Cta band" }));
    fireEvent.keyDown(screen.getByRole("option", { name: "Cta band" }), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Cta band" })).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Quote" })).toBeTruthy();
    expect(item("Quote").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Previous section" }));
    expect(screen.getByRole("dialog", { name: "Cta band" })).toBeTruthy();
    // Focus stays on the tile underneath, which must not swallow the key.
    fireEvent.keyDown(item("Cta band"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("edits a copy in the panel without the arrows stealing keys from its fields", async () => {
    mount();
    fireEvent.doubleClick(await screen.findByRole("option", { name: "Launch hero" }));
    const dialog = screen.getByRole("dialog", { name: "Launch hero" });
    const title = within(dialog).getByDisplayValue("Launch day");
    fireEvent.change(title, { target: { value: "New day" } });
    expect(within(dialog).getAllByText("New day").length).toBeGreaterThan(0);
    fireEvent.keyDown(title, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "Launch hero" })).toBeTruthy();
  });

  it("inserts the edited copy after a chosen slice of a page's draft", async () => {
    const user = userEvent.setup();
    const { insertSection, onOpenPage, onInserted } = mount();
    await user.dblClick(await screen.findByRole("option", { name: "Launch hero" }));
    const dialog = screen.getByRole("dialog", { name: "Launch hero" });
    fireEvent.change(within(dialog).getByDisplayValue("Launch day"), { target: { value: "Edited" } });
    expect((within(dialog).getByRole("button", { name: "Insert into page" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(dialog).getByRole("combobox", { name: "Page" }));
    await user.click(await screen.findByRole("option", { name: "About" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Position" }));
    await user.click(await screen.findByRole("option", { name: "After Intro" }));
    await user.click(within(dialog).getByRole("button", { name: "Insert into page" }));

    await waitFor(() => expect(insertSection).toHaveBeenCalled());
    expect(insertSection).toHaveBeenCalledWith("about", { slice: "hero", title: "Edited" }, 1, undefined, "en");
    expect(onInserted).toHaveBeenCalled();
    expect(await within(dialog).findByText(/Added to the About draft/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Open page" }));
    expect(onOpenPage).toHaveBeenCalledWith("about");
  });

  it("inserts against the page's version, and re-reads it after a conflict", async () => {
    const user = userEvent.setup();
    const { insertSection, host } = mount({ getPage: true, folder: "built-in" });
    insertSection.mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: "x" } as never);
    insertSection.mockRejectedValueOnce(new Error("disk full"));
    await user.dblClick(await screen.findByRole("option", { name: "Cta band" }));
    const dialog = screen.getByRole("dialog", { name: "Cta band" });
    await user.click(within(dialog).getByRole("combobox", { name: "Page" }));
    await user.click(await screen.findByRole("option", { name: "About" }));
    await user.click(within(dialog).getByRole("button", { name: "Insert into page" }));
    expect(await within(dialog).findByText(/changed since you picked it/)).toBeTruthy();
    expect(insertSection.mock.calls[0]).toEqual(["about", { slice: "cta_band", label_text: "Go" }, "end", "v1", "en"]);
    await waitFor(() => expect(host.getPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Insert into page" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(dialog).getByRole("button", { name: "Insert into page" }));
    expect(await within(dialog).findByText("Insert failed: disk full")).toBeTruthy();
  });

  it("saves changes to a saved section against the version opened", async () => {
    const user = userEvent.setup();
    const { library } = mount();
    library.update
      .mockResolvedValueOnce({ ok: true, saved: { ...saved[0]!, slice: { slice: "hero", title: "New" } } })
      .mockResolvedValueOnce({ ok: false, code: "conflict" })
      .mockResolvedValueOnce({ ok: false, code: "missing" })
      .mockRejectedValueOnce(new Error("Check out a branch in your site folder to save."));
    await user.dblClick(await screen.findByRole("option", { name: "Launch hero" }));
    const dialog = screen.getByRole("dialog", { name: "Launch hero" });
    const button = within(dialog).getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByDisplayValue("Launch day"), { target: { value: "New" } });
    await user.click(button);
    expect(library.update).toHaveBeenCalledWith("s1", { slice: "hero", title: "New" }, saved[0]!.savedAt);
    expect(await within(dialog).findByText("Saved")).toBeTruthy();
    await user.click(button);
    expect(await within(dialog).findByText(/changed elsewhere/)).toBeTruthy();
    await user.click(button);
    expect(await within(dialog).findByText("This section was deleted.")).toBeTruthy();
    await user.click(button);
    expect(await within(dialog).findByText("Save failed: Check out a branch in your site folder to save.")).toBeTruthy();
    expect(library.list.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("saves a built-in as a new section and opens it", async () => {
    const user = userEvent.setup();
    const { library } = mount({ folder: "built-in" });
    await user.dblClick(await screen.findByRole("option", { name: "Cta band" }));
    library.list.mockResolvedValue([...saved, { id: "new", name: "Cta band", savedAt: "2026-10-02T12:00:00Z", slice: { slice: "cta_band", label_text: "Go" } }]);
    await user.click(within(screen.getByRole("dialog", { name: "Cta band" })).getByRole("button", { name: "Save as new section" }));
    expect(library.save).toHaveBeenCalledWith("Cta band", { slice: "cta_band", label_text: "Go" });
    expect(await screen.findByRole("dialog", { name: "Cta band" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Cta band", selected: true, hidden: true }).textContent).toMatch(/Oct 2026/);
  });

  it("can't insert without a way to read pages", async () => {
    mount({ readPage: false });
    fireEvent.doubleClick(await screen.findByRole("option", { name: "Launch hero" }));
    expect(screen.getByText(/can’t read pages/)).toBeTruthy();
  });

  it("deletes a saved section after a confirm, never a built-in", async () => {
    const { library } = mount();
    await screen.findByRole("option", { name: "Launch hero" });
    expect(screen.queryByRole("button", { name: "Delete Cta band" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Launch hero" }));
    await answer("Cancel");
    expect(library.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Launch hero" }));
    await answer("Delete");
    await waitFor(() => expect(library.list).toHaveBeenCalledTimes(2));
    expect(library.remove).toHaveBeenCalledWith("s1");
  });

  it("says so when a delete fails", async () => {
    const { library } = mount({ view: "list" });
    library.remove.mockRejectedValueOnce(new Error("no"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Launch hero" }));
    await answer("Delete");
    expect(await screen.findByText("Delete failed")).toBeTruthy();
  });
});

describe("TyprenStudio Sections screen", () => {
  it("renders the library section with its own gallery/list toggle", async () => {
    const library = { list: vi.fn(async () => saved), save: vi.fn(), remove: vi.fn() };
    const host = {
      actions: {} as PageActions,
      sliceNames: [],
      defaults: {},
      previewPath: "/preview",
      library,
      sections: [{ kind: "pages", label: "Pages" }, { kind: "library", id: "sections", label: "Sections" }],
    } as unknown as TyprenStudioHost;
    render(<TyprenStudio host={host} pages={pages} sectionId="sections" onNavigate={vi.fn()} onReload={vi.fn()} />);
    expect(await screen.findByRole("option", { name: "Launch hero" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("row", { name: /Launch hero/ })).toBeTruthy();
  });
});

describe("SlicePreview", () => {
  const BASE = "https://site.test/typren/section";
  const frameOf = (c: HTMLElement) => c.querySelector("iframe")!;
  const post = (source: MessageEventSource | null, data: unknown, origin = "https://site.test") =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
    });

  it("is the sketch without a section route", () => {
    const { container } = render(<SlicePreview slice={{ slice: "hero", title: "Hi" }} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("Hi");
  });

  it("frames the site's render of the slice, keeping the sketch until the bridge reports it", async () => {
    const { container } = render(<SlicePreview base={BASE} slice={{ slice: "hero", title: "Hi" }} />);
    const frame = frameOf(container);
    expect(frame.getAttribute("src")).toBe(`${BASE}?slice=${encodeURIComponent('{"slice":"hero","title":"Hi"}')}`);
    expect(frame.getAttribute("sandbox")).toContain("allow-same-origin");
    expect(container.textContent).toContain("Hi");

    post(null, { __typren: true, type: "rects", rects: [{ index: 0, top: 64, left: 0, width: 1280, height: 400 }] });
    post(frame.contentWindow, { __typren: true, type: "rects", rects: [{ index: 0, top: 64, left: 0, width: 1280, height: 400 }] }, "https://evil.test");
    post(frame.contentWindow, { __typren: true, type: "rects", rects: [] });
    post(frame.contentWindow, { __typren: true, type: "rects", rects: [{ index: 0, top: 0, left: 0, width: 1280, height: 0 }] });
    post(frame.contentWindow, { type: "rects", rects: [{ index: 0, top: 64, left: 0, width: 1280, height: 400 }] });
    expect(container.textContent).toContain("Hi");

    post(frame.contentWindow, { __typren: true, type: "rects", rects: [{ index: 0, top: 64, left: 0, width: 1280, height: 2000 }] });
    // The sketch lingers under the fade-in, then goes.
    await waitFor(() => expect(container.textContent).not.toContain("Hi"));
    expect(frame.style.marginTop).toBe("-64px");
    expect((frame.parentElement as HTMLElement).style.height).toBe("736px");
  });

  it("reloads with edited props only after a pause", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<SlicePreview base={`${BASE}?x=1`} slice={{ slice: "hero" }} large />);
      rerender(<SlicePreview base={`${BASE}?x=1`} slice={{ slice: "hero", title: "A" }} large />);
      expect(frameOf(container).getAttribute("src")).toContain("&slice=%7B%22slice%22%3A%22hero%22%7D");
      act(() => vi.advanceTimersByTime(300));
      expect(frameOf(container).getAttribute("src")).toContain("title");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SectionsLibrary's shared canvas", () => {
  const BASE = "https://site.test/canvas";
  // A built-in is its type's defaults, then its type.
  const hero = { title: "Hi", slice: "hero" };
  const quote = { slice: "quote" };
  function setup() {
    sessionStorage.setItem(`typren:section-route:${BASE}`, "1");
    // jsdom lays nothing out: give the grid a size.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
    const library = { list: vi.fn(async () => []), save: vi.fn(), update: vi.fn(), remove: vi.fn() };
    const host = { library, sliceNames: ["hero", "quote"], defaults: { hero: { title: "Hi" } }, sectionPreviewUrl: BASE } as unknown as TyprenStudioHost;
    const view = render(<SectionsLibrary host={host} pages={[]} view="gallery" folder="built-in" />);
    const edit = (title: string) =>
      view.rerender(<SectionsLibrary host={{ ...host, defaults: { hero: { title } } }} pages={[]} view="gallery" folder="built-in" />);
    return { ...view, edit };
  }
  const canvas = () => document.querySelector<HTMLIFrameElement>('iframe[title="Section previews"]')!;
  const answer = (data: Record<string, unknown>, origin = "https://site.test") =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, ...data }, source: canvas().contentWindow, origin }));
    });
  it("loads one frame for every tile, carrying each slice by content key", async () => {
    setup();
    await waitFor(() => expect(canvas()).toBeTruthy());
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    const map = JSON.parse(new URL(canvas().src).searchParams.get("slices")!);
    expect(map).toEqual({ [sliceKey(hero)]: hero, [sliceKey(quote)]: quote });
    expect(canvas().getAttribute("sandbox")).toContain("allow-same-origin");
    // Hidden until the canvas answers with its colour scheme.
    expect(canvas().style.opacity).toBe("0");
  });

  it("posts the layout once the canvas answers, and shows each tile as it is drawn", async () => {
    setup();
    await waitFor(() => expect(canvas()).toBeTruthy());
    const sent = vi.spyOn(canvas().contentWindow!, "postMessage");
    answer({ type: "sections", ready: [], missing: [], colorScheme: "light" }, "https://evil.test");
    expect(sent).not.toHaveBeenCalled();
    answer({ type: "sections", ready: [], missing: [], colorScheme: "light" });
    expect(canvas().style.opacity).toBe("1");
    expect(canvas().style.colorScheme).toBe("light");
    const [data, origin] = sent.mock.calls.at(-1)! as [{ items: Array<{ key: string; slice: unknown; width: number }> }, string];
    expect(origin).toBe("https://site.test");
    expect(data.items.map((i) => i.slice)).toEqual([hero, quote]);
    expect(data.items[0]!.key).toBe(sliceKey(hero));

    answer({ type: "sections", ready: [sliceKey(hero)], missing: [] });
    const tile = screen.getByRole("option", { name: "Hero", hidden: true });
    expect(tile.querySelector("[data-typren-ready]")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Quote", hidden: true }).querySelector("[data-typren-ready]")).toBeNull();
    await waitFor(() => expect(tile.textContent).not.toContain("hero"));
  });

  it("reloads for a shown tile the frame's URL lacked, never for one it carried or one since gone", async () => {
    const { edit } = setup();
    await waitFor(() => expect(canvas()).toBeTruthy());
    const first = canvas().src;
    answer({ type: "sections", ready: [], missing: [sliceKey(quote), "gone"] });
    expect(canvas().src).toBe(first);
    edit("Bye");
    answer({ type: "sections", ready: [], missing: [sliceKey({ title: "Bye", slice: "hero" })] });
    expect(canvas().src).not.toBe(first);
    expect(canvas().src).toContain("Bye");
    expect(canvas().style.opacity).toBe("0");
  });

  it("falls back to a frame per tile when an older canvas answers with the one-slice bridge", async () => {
    setup();
    await waitFor(() => expect(canvas()).toBeTruthy());
    answer({ type: "rects", rects: [] });
    await waitFor(() => expect(canvas()).toBeNull());
    expect([...document.querySelectorAll("iframe")].every((f) => f.src.includes("?slice="))).toBe(true);
  });
});

describe("sliceKey", () => {
  it("is the same for equal slices and differs when one changes", () => {
    expect(sliceKey({ slice: "hero", title: "A" })).toBe(sliceKey({ slice: "hero", title: "A" }));
    expect(sliceKey({ slice: "hero", title: "A" })).not.toBe(sliceKey({ slice: "hero", title: "B" }));
  });
});

describe("useViewSlide", () => {
  function Probe({ view }: Readonly<{ view: AssetView }>) {
    return <div data-testid="probe" ref={useViewSlide(view)} />;
  }
  const setup = (reduce = false) => {
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce") }));
    return animate;
  };
  afterEach(() => vi.unstubAllGlobals());

  it("pushes left on to List and right back to Gallery", () => {
    const animate = setup();
    const { rerender } = render(<Probe view="gallery" />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Probe view="list" />);
    expect(animate.mock.calls[0]![0][0].transform).toBe("translateX(48px)");
    rerender(<Probe view="gallery" />);
    expect(animate.mock.calls[1]![0][0].transform).toBe("translateX(-48px)");
  });

  it("swaps instantly under reduced motion", () => {
    const animate = setup(true);
    const { rerender } = render(<Probe view="gallery" />);
    rerender(<Probe view="list" />);
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("probeSectionRoute", () => {
  const probeFrame = () => document.querySelector<HTMLIFrameElement>('iframe[aria-hidden="true"][src*="slice="]')!;

  it("finds the route once the bridge posts, and asks only once", async () => {
    const found = probeSectionRoute("https://site.test/ok", "https://studio.test");
    const frame = probeFrame();
    expect(frame.src).toBe(`https://site.test/ok?slice=${encodeURIComponent('{"slice":""}')}`);
    const rects = { __typren: true, type: "rects", rects: [] };
    window.dispatchEvent(new MessageEvent("message", { data: rects, source: null, origin: "https://site.test" }));
    // The frame navigated elsewhere keeps its WindowProxy; only its origin gives it away.
    window.dispatchEvent(new MessageEvent("message", { data: rects, source: frame.contentWindow, origin: "https://evil.test" }));
    expect(probeFrame()).toBe(frame);
    window.dispatchEvent(new MessageEvent("message", { data: rects, source: frame.contentWindow, origin: "https://site.test" }));
    expect(await found).toBe(true);
    expect(probeFrame()).toBeNull();
    expect(probeSectionRoute("https://site.test/ok", "https://studio.test")).toBe(found);
  });

  it("reads silence as a missing route", async () => {
    vi.useFakeTimers();
    try {
      const found = probeSectionRoute("https://site.test/missing", "https://studio.test");
      vi.advanceTimersByTime(20_000);
      expect(await found).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("frames tiles at once, and drops them when the probe finds no route", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    try {
      const library = { list: vi.fn(async () => []), save: vi.fn(), update: vi.fn(), remove: vi.fn() };
      const host = { library, sliceNames: ["hero"], defaults: {}, sectionPreviewUrl: "https://site.test/tiles" } as unknown as TyprenStudioHost;
      const { container } = render(<SectionsLibrary host={host} pages={[]} view="gallery" folder="built-in" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(container.querySelector("iframe")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(container.querySelector("iframe")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("remembers a found route for the session, so a revisit skips the frame", async () => {
    const base = "https://site.test/remembered";
    const found = probeSectionRoute(base, "https://studio.test");
    window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, type: "rects", rects: [] }, source: probeFrame().contentWindow, origin: "https://site.test" }));
    await found;
    expect(sessionStorage.getItem(`typren:section-route:${base}`)).toBe("1");
    sessionStorage.setItem("typren:section-route:https://site.test/earlier", "1");
    expect(await probeSectionRoute("https://site.test/earlier", "https://studio.test")).toBe(true);
    expect(probeFrame()).toBeNull();
  });
});

describe("acquireFrame", () => {
  it("runs four at a time, the rest in order as slots free, and a queued one can leave", () => {
    const ran: number[] = [];
    const releases = [0, 1, 2, 3, 4, 5].map((i) => acquireFrame(() => ran.push(i)));
    expect(ran).toEqual([0, 1, 2, 3]);
    releases[4]!();
    releases[0]!();
    releases[0]!();
    expect(ran).toEqual([0, 1, 2, 3, 5]);
    [1, 2, 3, 5].forEach((i) => releases[i]!());
  });
});
