import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset, PageActions, PageInfo } from "@typren/core";
import { TyprenStudio, type TyprenStudioHost, type TyprenStudioProps } from "./typren-studio";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const asset = (id: string, folder = ""): MediaAsset => ({ id, url: `/img/${id}.webp`, name: `${id}.webp`, size: 1024, mime: "image/webp", createdAt: "2026-01-01", folder });
const assets = [asset("hero"), asset("pic", "events")];
const pages: PageInfo[] = [{ slug: "about", title: "About", hasDraft: false, locales: ["en"], nav: true }];

const setup = (extra: Partial<TyprenStudioProps> = {}, withFolders = true, failList = false) => {
  const media = {
    list: vi.fn(async () => (failList ? Promise.reject(new Error("down")) : assets)),
    delete: vi.fn(async () => {}),
    uploadPath: "/upload",
    usage: vi.fn(async () => ({ "/img/hero.webp": [{ slug: "about", locale: "en", count: 1 }, { slug: "settings", locale: "en", count: 1 }] })),
    folders: withFolders
      ? {
          list: vi.fn(async () => ["events", "empty"]),
          create: vi.fn(async () => {}),
          delete: vi.fn(async () => {}),
          move: vi.fn(async () => assets[0]!),
          rename: vi.fn(async () => {}),
        }
      : undefined,
  };
  const host = {
    actions: {} as PageActions,
    sliceNames: [],
    defaults: {},
    previewPath: "/preview",
    sections: [{ kind: "pages", label: "Pages" }, { kind: "media", label: "Assets", id: "assets" }, { kind: "settings", label: "Settings" }],
    media,
  } as unknown as TyprenStudioHost;
  const props = { onNavigate: vi.fn(), onNavigateSection: vi.fn(), onNavigateAssetFolder: vi.fn(), onReload: vi.fn() };
  render(<TyprenStudio host={host} pages={pages} sectionId="assets" {...props} {...extra} />);
  return { media, ...props };
};

describe("TyprenStudio assets", () => {
  it("loads the library on entering Assets and shows its folder tree", async () => {
    const { media } = setup();
    expect(await screen.findByRole("option", { name: "hero.webp" })).toBeTruthy();
    expect(media.list).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^empty/ })).toBeTruthy();
  });

  it("survives a failing library load", async () => {
    const { media } = setup({}, true, true);
    await waitFor(() => expect(media.list).toHaveBeenCalled());
    expect(screen.getAllByRole("button", { name: /All Assets/ }).length).toBeGreaterThan(0);
  });

  it("opening a folder in the rail reports it and shows its assets", async () => {
    const { onNavigateAssetFolder } = setup();
    await screen.findByRole("option", { name: "hero.webp" });
    await userEvent.setup().click(screen.getByRole("button", { name: /^events/ }));
    expect(onNavigateAssetFolder).toHaveBeenCalledWith("events");
    expect(await screen.findByRole("option", { name: "pic.webp" })).toBeTruthy();
  });

  it("follows a host-controlled folder", async () => {
    setup({ assetFolder: "events" });
    expect(await screen.findByRole("option", { name: "pic.webp" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "hero.webp" })).toBeNull();
  });

  it("creates, renames and deletes folders through the adapter and reloads", async () => {
    const { media } = setup();
    await screen.findByRole("option", { name: "hero.webp" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add to assets" }));
    await user.click(await screen.findByRole("button", { name: /New folder/ }));
    await user.type(screen.getByPlaceholderText("Folder name"), "fresh{Enter}");
    await waitFor(() => expect(media.folders!.create).toHaveBeenCalledWith("fresh"));
    await waitFor(() => expect(media.list.mock.calls.length).toBeGreaterThan(1));

    fireEvent.doubleClick(screen.getByRole("button", { name: /^empty/ }));
    const box = screen.getByRole("textbox", { name: "Rename empty" });
    box.textContent = "gone";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(media.folders!.rename).toHaveBeenCalledWith("empty", "gone"));

    // The rename box closes on its own; a click landing mid-close is swallowed.
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Rename empty" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Delete folder empty" }));
    await answer("Delete");
    await waitFor(() => expect(media.folders!.delete).toHaveBeenCalledWith("empty"));
  });

  it("uploads from the rail into the open folder, then reloads", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { media } = setup({ assetFolder: "events" });
    await screen.findByRole("option", { name: "pic.webp" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add to assets" }));
    await user.click(await screen.findByRole("button", { name: /Upload/ }));
    await user.upload(screen.getByLabelText("Upload images"), new File(["x"], "x.png", { type: "image/png" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/upload", expect.anything()));
    await waitFor(() => expect(media.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("dropping a tile on a rail folder moves the asset and reloads", async () => {
    const { media } = setup();
    await screen.findByRole("option", { name: "hero.webp" });
    const data = { types: ["application/x-typren-asset"], getData: () => "hero" };
    fireEvent.drop(screen.getByRole("button", { name: /^empty/ }).closest("li")!, { dataTransfer: data });
    await waitFor(() => expect(media.folders!.move).toHaveBeenCalledWith("hero", "empty"));
    await waitFor(() => expect(media.list.mock.calls.length).toBeGreaterThan(1));
  });

  it("a flat library offers no folder actions", async () => {
    setup({}, false);
    await screen.findByRole("option", { name: "hero.webp" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Add to assets" }));
    expect(await screen.findByRole("button", { name: /Upload/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
  });

  it("the view toggle switches to the list and is remembered", async () => {
    setup();
    await screen.findByRole("option", { name: "hero.webp" });
    await userEvent.setup().click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("grid")).toBeTruthy();
    expect(localStorage.getItem("typren-asset-view")).toBe("list");
    cleanup();
    setup();
    expect(await screen.findByRole("grid")).toBeTruthy();
  });

  it("ignores a stored view it does not know, and tolerates unusable storage", async () => {
    localStorage.setItem("typren-asset-view", "bogus");
    setup();
    expect(await screen.findByRole("option", { name: "hero.webp" })).toBeTruthy();
    cleanup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setup();
    await screen.findByRole("option", { name: "hero.webp" });
    await userEvent.setup().click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("grid")).toBeTruthy();
  });

  it("opening a page from an asset's usage navigates there", async () => {
    const { onNavigate, onNavigateSection } = setup();
    await screen.findByRole("option", { name: "hero.webp" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "List" }));
    await user.click(await screen.findByRole("button", { name: "Where hero.webp is used" }));
    await user.click(await screen.findByRole("button", { name: /\/about/ }));
    expect(onNavigateSection).toHaveBeenCalledWith("pages");
    expect(onNavigate).toHaveBeenCalledWith("about");
  });

  it("opening site settings from an asset's usage navigates to settings", async () => {
    const { onNavigateSection } = setup();
    await screen.findByRole("option", { name: "hero.webp" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "List" }));
    await user.click(await screen.findByRole("button", { name: "Where hero.webp is used" }));
    fireEvent.click(await screen.findByRole("button", { name: /Site settings/ }));
    expect(onNavigateSection).toHaveBeenCalledWith("settings");
  });

  it("one click on Assets from the site level slides the rail once, before and after the host confirms", async () => {
    const animate = vi.fn();
    Element.prototype.animate = animate as never;
    const host = {
      actions: {} as PageActions,
      sliceNames: [],
      defaults: {},
      previewPath: "/preview",
      sections: [{ kind: "pages", label: "Pages" }, { kind: "media", label: "Assets", id: "assets" }],
      media: { list: vi.fn(async () => assets), delete: vi.fn(), uploadPath: "/upload" },
    } as unknown as TyprenStudioHost;
    const props = { host, pages, onNavigate: vi.fn(), onReload: vi.fn() };
    const { rerender } = render(<TyprenStudio {...props} />);
    animate.mockClear();
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Assets" })[0]!);
    const rail = () => animate.mock.calls.filter(([, o]) => (o as KeyframeAnimationOptions).duration === 560);
    expect(rail()).toHaveLength(2);
    rerender(<TyprenStudio {...props} sectionId="assets" />);
    expect(rail()).toHaveLength(2);
  });
});
