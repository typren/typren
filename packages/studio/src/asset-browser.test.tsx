import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@typren/core";
import { PortalContext } from "./primitives/portal";
import { MediaOriginProvider } from "./media-url";
import { ASSET_DRAG_TYPE, AssetBrowser, AssetViewToggle, InlineRename, ItemMenu } from "./asset-browser";

afterEach(cleanup);

const a = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  url: `/img/${id}.webp`,
  name: `${id}.webp`,
  size: 2048,
  mime: "image/webp",
  createdAt: "2026-10-27T12:00:00Z",
  ...extra,
});
const assets = [a("one", { width: 40, height: 20 }), a("two"), a("three")];
const subfolders = [
  { folder: "events", items: 1, size: 1024 },
  { folder: "empty", items: 0, size: 0 },
];

const mount = (props: Partial<Parameters<typeof AssetBrowser>[0]> = {}) => {
  const fns = {
    onOpenFolder: vi.fn(),
    onOpenPage: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onUploadFiles: vi.fn(),
    onRename: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
  };
  const r = render(
    <PortalContext.Provider value={document.body}>
      <AssetBrowser assets={assets} subfolders={subfolders} view="gallery" folders={["", "events", "empty"]} {...fns} {...props} />
    </PortalContext.Provider>
  );
  return { ...fns, ...r };
};
const option = (name: string) => screen.getByRole("option", { name, hidden: true });
const dataTransfer = (data: Record<string, string> = {}, files: File[] = []) => ({
  types: Object.keys(data),
  files,
  getData: (t: string) => data[t] ?? "",
  setData: vi.fn(),
});

describe("InlineRename", () => {
  const setup = (props: Partial<Parameters<typeof InlineRename>[0]> = {}) => {
    const onDone = vi.fn();
    render(<InlineRename value="hero.webp" keep=".webp" editing onDone={onDone} {...props} />);
    return { onDone, box: screen.getByRole("textbox", { name: "Rename hero.webp" }) };
  };
  const type = (box: HTMLElement, text: string) => {
    box.textContent = text;
    fireEvent.input(box);
  };

  it("is plain text when not editing", () => {
    render(<InlineRename value="hero" editing={false} onDone={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("hero")).toBeTruthy();
  });

  it("Enter commits a changed value", () => {
    const { onDone, box } = setup();
    type(box, "new.webp");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onDone).toHaveBeenCalledWith("new.webp");
    expect(box.textContent).toBe("hero.webp");
  });

  it("Escape restores, an unchanged value reports null", () => {
    const { onDone, box } = setup();
    type(box, "new.webp");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onDone).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onDone).toHaveBeenLastCalledWith(null);
  });

  it("works without a keep extension that the value lacks", () => {
    const { onDone, box } = setup({ keep: ".png" });
    type(box, "x");
    fireEvent.blur(box);
    expect(onDone).toHaveBeenCalledWith("x");
  });

  it("a validation reason shows as an alert, blocks Enter, and blur reverts", () => {
    const { onDone, box } = setup({ validate: (n) => (n === "bad" ? "Nope." : null) });
    type(box, "bad");
    expect(screen.getByRole("alert").textContent).toBe("Nope.");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onDone).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("alert")).toBeNull();
    type(box, "good");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a click while editing does not bubble; blur when idle does nothing", () => {
    const outer = vi.fn();
    const onDone = vi.fn();
    const { rerender } = render(
      <div onClick={outer}>
        <InlineRename value="hero" editing onDone={onDone} />
      </div>
    );
    fireEvent.click(screen.getByRole("textbox"));
    expect(outer).not.toHaveBeenCalled();
    rerender(
      <div onClick={outer}>
        <InlineRename value="hero" editing={false} onDone={onDone} />
      </div>
    );
    fireEvent.click(screen.getByText("hero"));
    fireEvent.keyDown(screen.getByText("hero"), { key: "Enter" });
    fireEvent.blur(screen.getByText("hero"));
    expect(outer).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("ItemMenu", () => {
  it("offers only the actions it is given", async () => {
    render(
      <PortalContext.Provider value={document.body}>
        <ItemMenu onCopy={() => {}}>
          <span>target</span>
        </ItemMenu>
      </PortalContext.Provider>
    );
    fireEvent.contextMenu(screen.getByText("target"));
    expect(await screen.findByRole("menuitem", { name: /Copy URL/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
  });
});

describe("AssetViewToggle", () => {
  it("reports the chosen view", async () => {
    const onChange = vi.fn();
    render(<AssetViewToggle view="gallery" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "List" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });
});

describe.each(["gallery", "list"] as const)("AssetBrowser (%s)", (view) => {
  const row = (name: string) => (view === "gallery" ? option(name) : screen.getAllByRole("row", { hidden: true }).find((r) => within(r).queryByText(name))!);
  const nameOf = (name: string) => screen.getByText(name);

  it("keeps one tab stop and moves DOM focus with the arrows", () => {
    mount({ view });
    const stops = () => screen.getAllByRole(view === "gallery" ? "option" : "row", { hidden: true }).filter((el) => el.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    fireEvent.click(row("one.webp"));
    row("one.webp").focus();
    fireEvent.keyDown(row("one.webp"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("two.webp"));
    expect(row("two.webp").tabIndex).toBe(0);
    expect(row("one.webp").tabIndex).toBe(-1);
    expect(stops()).toHaveLength(1);
  });

  it("shows the empty state", () => {
    mount({ assets: [], subfolders: [], view });
    expect(screen.getByText(/Drop images here/)).toBeTruthy();
  });

  it("click selects, clicking the background deselects", () => {
    const { container } = mount({ view });
    fireEvent.click(row("two.webp"));
    expect(row("two.webp").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(container.firstElementChild!);
    expect(row("two.webp").getAttribute("aria-selected")).toBe("false");
  });

  it("double-click opens a folder, or an asset in the viewer", async () => {
    const { onOpenFolder } = mount({ view });
    fireEvent.doubleClick(row("events"));
    expect(onOpenFolder).toHaveBeenCalledWith("events");
    fireEvent.doubleClick(row("two.webp"));
    expect(screen.getByRole("dialog", { name: "two.webp" })).toBeTruthy();
  });

  it("Space opens Quick Look, Enter opens, arrows move, Escape deselects", () => {
    const { onOpenFolder } = mount({ view });
    fireEvent.click(row("two.webp"));
    fireEvent.keyDown(row("two.webp"), { key: " " });
    expect(screen.getByRole("dialog", { name: /^Quick Look/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(row("three.webp").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(row("three.webp"), { key: "ArrowRight" });
    expect(row("three.webp").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(row("three.webp"), { key: "ArrowDown" });
    fireEvent.keyDown(row("three.webp"), { key: "ArrowLeft" });
    expect(row("two.webp").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(row("two.webp"), { key: "ArrowUp" });
    expect(row("one.webp").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(row("one.webp"), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "one.webp" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });

    fireEvent.click(row("events"));
    fireEvent.keyDown(row("events"), { key: " " });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(row("events"), { key: "Enter" });
    expect(onOpenFolder).toHaveBeenCalledWith("events");
    fireEvent.keyDown(row("events"), { key: "x" });
    fireEvent.keyDown(row("events"), { key: "Escape" });
    expect(row("events").getAttribute("aria-selected")).toBe("false");
    fireEvent.keyDown(row("events"), { key: "Enter" });
  });

  it("stepping in the viewer moves the selection", () => {
    mount({ view });
    fireEvent.doubleClick(row("two.webp"));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "three.webp" })).toBeTruthy();
    expect(row("three.webp").getAttribute("aria-selected")).toBe("true");
  });

  it("double-clicking a name renames instead of opening, Enter commits", () => {
    const { onRename } = mount({ view });
    fireEvent.doubleClick(nameOf("two.webp"));
    expect(screen.queryByRole("dialog")).toBeNull();
    const box = screen.getByRole("textbox", { name: "Rename two.webp" });
    box.textContent = "second.webp";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("two", "second");
  });

  it("a renamed asset without the extension keeps it implied", () => {
    const { onRename } = mount({ view });
    fireEvent.doubleClick(nameOf("two.webp"));
    const box = screen.getByRole("textbox");
    box.textContent = "second";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("two", "second");
  });

  it("rename validation rejects a taken asset name", () => {
    const { onRename } = mount({ view });
    fireEvent.doubleClick(nameOf("two.webp"));
    const box = screen.getByRole("textbox");
    box.textContent = "three.webp";
    fireEvent.input(box);
    expect(screen.getByRole("alert").textContent).toMatch(/already used/);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("renames a folder, rejecting a sibling's name", () => {
    const { onRenameFolder } = mount({ view });
    fireEvent.doubleClick(nameOf("events"));
    const box = screen.getByRole("textbox", { name: "Rename events" });
    box.textContent = "empty";
    fireEvent.input(box);
    expect(screen.getByRole("alert")).toBeTruthy();
    box.textContent = "shows";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRenameFolder).toHaveBeenCalledWith("events", "shows");
  });

  it("keys are ignored while renaming", () => {
    mount({ view });
    fireEvent.click(row("two.webp"));
    fireEvent.doubleClick(nameOf("two.webp"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("without rename handlers a name double-click does nothing", () => {
    mount({ view, onRename: undefined, onRenameFolder: undefined });
    fireEvent.doubleClick(nameOf("two.webp"));
    fireEvent.doubleClick(nameOf("events"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("right-click menu: rename, copy URL, delete", async () => {
    const { onDelete } = mount({ view });
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.contextMenu(nameOf("two.webp"));
    await user.click(await screen.findByRole("menuitem", { name: /Copy URL/ }));
    expect(writeText).toHaveBeenCalledWith("/img/two.webp");
    fireEvent.contextMenu(nameOf("two.webp"));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith("two");
    fireEvent.contextMenu(nameOf("two.webp"));
    await user.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    expect(await screen.findByRole("textbox", { name: "Rename two.webp" })).toBeTruthy();
  });

  it("action buttons and the folder menu's Rename do not trigger the item's double-click", async () => {
    mount({ view });
    fireEvent.doubleClick(screen.getByRole("button", { name: "Copy two.webp URL" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.contextMenu(nameOf("events"));
    await userEvent.setup().click(await screen.findByRole("menuitem", { name: /Rename/ }));
    expect(await screen.findByRole("textbox", { name: "Rename events" })).toBeTruthy();
  });

  it("folder menu: Delete only for an empty folder; rename starts editing", async () => {
    const { onDeleteFolder } = mount({ view });
    const user = userEvent.setup();
    fireEvent.contextMenu(nameOf("events"));
    expect(await screen.findByRole("menuitem", { name: /Rename/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    fireEvent.contextMenu(nameOf("empty"));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    expect(onDeleteFolder).toHaveBeenCalledWith("empty");
  });

  it("hover actions copy, delete and move", async () => {
    const { onDelete, onMove } = mount({ view });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy two.webp URL" }));
    expect(writeText).toHaveBeenCalledWith("/img/two.webp");
    await user.click(screen.getByRole("button", { name: "Delete two.webp" }));
    expect(onDelete).toHaveBeenCalledWith("two");
    await user.click(screen.getByRole("combobox", { name: "Move two.webp" }));
    await waitFor(() => expect(document.querySelector("[data-slot=select-item]")).toBeTruthy());
    await user.click([...document.querySelectorAll("[data-slot=select-item]")].find((i) => i.textContent === "events")!);
    expect(onMove).toHaveBeenCalledWith("two", "events");
  });

  it("omits Move without folders or a move handler", () => {
    mount({ view, folders: undefined });
    expect(screen.queryByRole("combobox", { name: /Move/ })).toBeNull();
    cleanup();
    mount({ view, onMove: undefined });
    expect(screen.queryByRole("combobox", { name: /Move/ })).toBeNull();
  });

  it("dragging an asset onto a folder moves it", () => {
    const { onMove } = mount({ view });
    const dt = dataTransfer();
    fireEvent.dragStart(row("two.webp"), { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith(ASSET_DRAG_TYPE, "two");
    const over = createEvent.dragOver(row("events"), { dataTransfer: dataTransfer({ [ASSET_DRAG_TYPE]: "two" }) });
    fireEvent(row("events"), over);
    expect(over.defaultPrevented).toBe(true);
    const plain = createEvent.dragOver(row("events"), { dataTransfer: dataTransfer() });
    fireEvent(row("events"), plain);
    expect(plain.defaultPrevented).toBe(true);
    fireEvent.drop(row("events"), { dataTransfer: dataTransfer({ [ASSET_DRAG_TYPE]: "two" }) });
    expect(onMove).toHaveBeenCalledWith("two", "events");
  });

  it("a drop without an asset payload on a folder is ignored by the folder", () => {
    const { onMove, onUploadFiles } = mount({ view });
    fireEvent.drop(row("events"), { dataTransfer: dataTransfer() });
    expect(onMove).not.toHaveBeenCalled();
    expect(onUploadFiles).not.toHaveBeenCalled();
  });

  it("without onMove, folder dragover is not accepted", () => {
    mount({ view, onMove: undefined });
    const over = createEvent.dragOver(row("events"), { dataTransfer: dataTransfer({ [ASSET_DRAG_TYPE]: "two" }) });
    fireEvent(row("events"), over);
    expect(row("two.webp").getAttribute("draggable")).not.toBe("true");
  });

  it("dropping files anywhere uploads them", () => {
    const { onUploadFiles, container } = mount({ view });
    const file = new File(["x"], "x.png", { type: "image/png" });
    fireEvent.dragOver(container.firstElementChild!);
    fireEvent.drop(container.firstElementChild!, { dataTransfer: dataTransfer({}, [file]) });
    expect(onUploadFiles).toHaveBeenCalledTimes(1);
    fireEvent.drop(container.firstElementChild!, { dataTransfer: dataTransfer() });
    expect(onUploadFiles).toHaveBeenCalledTimes(1);
  });
});

describe("AssetBrowser usage", () => {
  const usage = { "/img/two.webp": [{ slug: "about", locale: "en", count: 2 }] };

  it("list view shows a use count and a popover of pages that open them", async () => {
    const { onOpenPage } = mount({ view: "list", usage });
    const user = userEvent.setup();
    const info = screen.getByRole("button", { name: "Where two.webp is used" });
    expect(info.parentElement!.textContent).toBe("2");
    expect(screen.getByRole("button", { name: "Where one.webp is used" }).parentElement!.textContent).toBe("0");
    await user.click(info);
    expect(await screen.findByText("Used on 1 page")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /\/about/ }));
    expect(onOpenPage).toHaveBeenCalledWith("about");
    fireEvent.pointerLeave(info);
    await waitFor(() => expect(screen.queryByText("Used on 1 page")).toBeNull(), { timeout: 1000 });
  });

  it("an unused asset's popover names the asset", async () => {
    mount({ view: "list", usage });
    await userEvent.setup().click(screen.getByRole("button", { name: "Where one.webp is used" }));
    expect(await screen.findByText("Not used on any page.")).toBeTruthy();
  });

  it("pointer re-entry cancels the pending close", () => {
    mount({ view: "list", usage });
    const info = screen.getByRole("button", { name: "Where two.webp is used" });
    fireEvent.pointerLeave(info);
    fireEvent.pointerEnter(info);
    expect(info).toBeTruthy();
  });

  it("the viewer gets the asset's usage", () => {
    mount({ view: "gallery", usage });
    fireEvent.doubleClick(option("two.webp"));
    expect(screen.getByText("Used 2 times")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.doubleClick(option("one.webp"));
    expect(screen.getByText("Used 0 times")).toBeTruthy();
  });

  it("list view without usage has no Used column", () => {
    mount({ view: "list" });
    expect(screen.queryByText("Used")).toBeNull();
  });
});

describe("AssetBrowser sorting", () => {
  const sized = [a("one", { size: 300 }), a("two", { size: 100 }), a("three", { size: 200 })];
  const names = () => screen.getAllByRole("row", { hidden: true }).slice(1).map((r) => r.textContent ?? "");

  it("sorts assets under folders, and the arrow keys follow the sorted order", () => {
    localStorage.clear();
    mount({ view: "list", assets: sized });
    const header = screen.getByRole("button", { name: "Size" });
    fireEvent.click(header);
    expect(header.closest("th")!.getAttribute("aria-sort")).toBe("ascending");
    expect(names().map((n) => n.replace(/\W.*/, "")).slice(-3)).toEqual(["two", "three", "one"]);
    expect(localStorage.getItem("typren-asset-sort")).toBe("size:asc");
    fireEvent.click(screen.getAllByRole("row", { hidden: true })[3]!);
    fireEvent.keyDown(screen.getAllByRole("row", { hidden: true })[3]!, { key: "ArrowRight" });
    expect(screen.getAllByRole("row", { hidden: true })[4]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(header);
    expect(names().map((n) => n.replace(/\W.*/, "")).slice(-3)).toEqual(["one", "three", "two"]);
    fireEvent.click(header);
    expect(names().map((n) => n.replace(/\W.*/, "")).slice(-3)).toEqual(["one", "two", "three"]);
  });
});

describe("AssetBrowser drag and drop upload", () => {
  const file = new File(["x"], "x.png", { type: "image/png" });
  const folder = () => screen.getByRole("option", { name: "events" });

  it("files dropped on a folder upload into it, highlighting while over", () => {
    const { onUploadFiles, onMove } = mount();
    const dt = dataTransfer({ Files: "" }, [file]);
    fireEvent.dragOver(folder(), { dataTransfer: dt });
    expect(folder().querySelector(".ring-2")).toBeTruthy();
    fireEvent.dragLeave(folder(), { dataTransfer: dt });
    expect(folder().querySelector(".ring-2")).toBeNull();
    fireEvent.drop(folder(), { dataTransfer: dt });
    expect(onUploadFiles).toHaveBeenCalledTimes(1);
    expect(onUploadFiles).toHaveBeenCalledWith([file], "events");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("files dropped elsewhere upload into the current folder, other drags are ignored", () => {
    const { onUploadFiles, container } = mount();
    fireEvent.drop(container.firstElementChild!, { dataTransfer: dataTransfer({ Files: "" }, [file]) });
    expect(onUploadFiles).toHaveBeenCalledWith([file]);
    const text = createEvent.dragOver(folder(), { dataTransfer: dataTransfer({ "text/plain": "x" }) });
    fireEvent(folder(), text);
    expect(folder().querySelector(".ring-2")).toBeNull();
  });
});

describe("AssetBrowser media origin", () => {
  it("resolves gallery and list thumbnails against the site origin", () => {
    const props = { assets: [a("one")], onOpenFolder: vi.fn(), onDelete: vi.fn(), onUploadFiles: vi.fn() };
    const { container, rerender } = render(
      <MediaOriginProvider origin="http://127.0.0.1:3000">
        <AssetBrowser {...props} view="gallery" />
      </MediaOriginProvider>
    );
    expect(container.querySelector("img")!.getAttribute("src")).toBe("http://127.0.0.1:3000/img/one.webp");
    rerender(
      <MediaOriginProvider origin="http://127.0.0.1:3000">
        <AssetBrowser {...props} view="list" />
      </MediaOriginProvider>
    );
    expect(container.querySelector("img")!.getAttribute("src")).toBe("http://127.0.0.1:3000/img/one.webp");
  });
});
