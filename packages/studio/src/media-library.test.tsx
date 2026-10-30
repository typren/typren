import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import { MediaLibrarySection, uploadAssets } from "./media-library";
import { PortalContext } from "./primitives/portal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const a = (id: string, folder = "", size = 1024): MediaAsset => ({
  id,
  url: `/img/${id}.webp`,
  name: `${id}.webp`,
  size,
  mime: "image/webp",
  createdAt: "2026-01-01",
  folder,
});
const assets = [a("hero"), a("pic", "events", 2048), a("deep", "events/2025", 4096)];
const folders = ["events", "events/2025", "empty"];

const makeMedia = (extra: Partial<FieldFormMedia> = {}): FieldFormMedia => ({
  list: vi.fn(async () => assets),
  delete: vi.fn(async () => {}),
  uploadPath: "/upload",
  usage: vi.fn(async () => ({ "/img/hero.webp": [{ slug: "about", locale: "en", count: 1 }] })),
  folders: {
    list: vi.fn(async () => folders),
    create: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    move: vi.fn(async () => assets[0]!),
    rename: vi.fn(async () => {}),
  },
  ...extra,
});

const mount = (media: FieldFormMedia | undefined, props: Partial<Parameters<typeof MediaLibrarySection>[0]> = {}) => {
  const fns = { onOpenFolder: vi.fn(), onOpenPage: vi.fn(), onChange: vi.fn(async () => {}) };
  const ui = (p: Partial<Parameters<typeof MediaLibrarySection>[0]>) => (
    <PortalContext.Provider value={document.body}>
      <MediaLibrarySection media={media} assets={assets} folders={folders} {...fns} {...props} {...p} />
    </PortalContext.Provider>
  );
  const r = render(ui({}));
  return { ...fns, rerender: (p: Partial<Parameters<typeof MediaLibrarySection>[0]>) => r.rerender(ui(p)) };
};
const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));
const crumbs = () => within(screen.getByRole("navigation", { name: "Folder" }));

const iconOf = (text: HTMLElement) => text.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
describe("MediaLibrarySection", () => {
  it("says so when no media adapter is wired", () => {
    render(<MediaLibrarySection />);
    expect(iconOf(screen.getByText(/isn.t configured/))).toBeTruthy();
  });

  it("blurs behind the breadcrumb bar only once the list has scrolled", () => {
    mount(makeMedia());
    const bar = screen.getByRole("navigation", { name: "Folder" });
    const scroller = bar.closest("[data-slot=scroll-area-viewport]")!;
    expect(bar.hasAttribute("data-scrolled")).toBe(false);
    scroller.scrollTop = 20;
    fireEvent.scroll(scroller);
    expect(bar.hasAttribute("data-scrolled")).toBe(true);
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(bar.hasAttribute("data-scrolled")).toBe(false);
  });

  it("holds a skeleton of the grid or the list until the lists load", () => {
    mount(makeMedia(), { ready: false });
    const status = screen.getByRole("status", { name: "Loading" });
    expect(status.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0);
    expect(screen.queryByRole("listbox")).toBeNull();
    cleanup();
    mount(makeMedia(), { ready: false, view: "list" });
    expect(screen.getByRole("status", { name: "Loading" }).querySelectorAll(".h-12")).toHaveLength(8);
  });

  it("eases the blur off in layers, strongest at the top", () => {
    mount(makeMedia());
    const layers = Array.from(screen.getByRole("navigation", { name: "Folder" }).querySelectorAll<HTMLElement>("[aria-hidden] > div"));
    expect(layers.map((l) => l.style.backdropFilter)).toEqual(["blur(12px)", "blur(6px)", "blur(2px)"]);
  });

  it("shows the current folder's assets and subfolders with counts and sizes", () => {
    mount(makeMedia());
    expect(screen.getByRole("option", { name: "hero.webp" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "pic.webp" })).toBeNull();
    expect(screen.getByText("2 items · 6 KB")).toBeTruthy();
    expect(screen.getByText("0 items · 0 B")).toBeTruthy();
  });

  it("a flat library (no folders) shows every asset", () => {
    mount(makeMedia({ folders: undefined }), { folders: undefined });
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("works with no assets prop and no usage adapter", () => {
    render(<MediaLibrarySection media={{ list: async () => [], delete: async () => {}, uploadPath: "/u" }} />);
    expect(screen.getByText(/Drop images here/)).toBeTruthy();
  });

  it("fetches usage and shows it in the list view; a failure drops it", async () => {
    const media = makeMedia();
    mount(media, { view: "list" });
    expect(await screen.findByRole("button", { name: "Where hero.webp is used" })).toBeTruthy();
    cleanup();
    mount(makeMedia({ usage: vi.fn(async () => Promise.reject(new Error("x"))) }), { view: "list" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /is used/ })).toBeNull());
  });

  it("opening an asset's page goes through onOpenPage", async () => {
    const { onOpenPage } = mount(makeMedia(), { view: "list" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Where hero.webp is used" }));
    await user.click(await screen.findByRole("button", { name: /\/about/ }));
    expect(onOpenPage).toHaveBeenCalledWith("about");
  });

  describe("breadcrumbs", () => {
    it("lists the path and opens ancestors", async () => {
      const { onOpenFolder } = mount(makeMedia(), { folder: "events/2025" });
      const user = userEvent.setup();
      expect(crumbs().getByRole("button", { name: "2025" }).getAttribute("aria-current")).toBe("location");
      await user.click(crumbs().getByRole("button", { name: "events" }));
      expect(onOpenFolder).toHaveBeenCalledWith("events");
      await user.click(crumbs().getByRole("button", { name: "All Assets" }));
      expect(onOpenFolder).toHaveBeenLastCalledWith("");
    });

    it("Back and Forward follow the folders visited", async () => {
      const { onOpenFolder, rerender } = mount(makeMedia());
      const user = userEvent.setup();
      const back = crumbs().getByRole("button", { name: "Back" }) as HTMLButtonElement;
      const forward = crumbs().getByRole("button", { name: "Forward" }) as HTMLButtonElement;
      expect(back.disabled).toBe(true);
      expect(forward.disabled).toBe(true);
      rerender({ folder: "events" });
      expect(back.disabled).toBe(false);
      await user.click(back);
      expect(onOpenFolder).toHaveBeenLastCalledWith("");
      rerender({ folder: "" });
      expect(forward.disabled).toBe(false);
      await user.click(forward);
      expect(onOpenFolder).toHaveBeenLastCalledWith("events");
      rerender({ folder: "events" });
      rerender({ folder: "empty" });
      rerender({ folder: "events" });
      expect(forward.disabled).toBe(false);
      rerender({ folder: "empty" });
      expect(forward.disabled).toBe(true);
    });
  });

  describe("changes", () => {
    it("confirming a delete removes the asset and reloads", async () => {
      const media = makeMedia({ usage: undefined });
      const { onChange } = mount(media);
      await userEvent.setup().click(screen.getByRole("button", { name: "Delete hero.webp" }));
      await answer("Delete");
      await waitFor(() => expect(media.delete).toHaveBeenCalledWith("hero"));
      await waitFor(() => expect(onChange).toHaveBeenCalled());
    });

    it("declining the confirm leaves the asset alone", async () => {
      const media = makeMedia();
      mount(media);
      await userEvent.setup().click(screen.getByRole("button", { name: "Delete hero.webp" }));
      await answer("Cancel");
      expect(media.delete).not.toHaveBeenCalled();
    });

    it("lists the pages an asset is used on before it is deleted", async () => {
      const media = makeMedia();
      mount(media);
      await waitFor(() => expect(media.usage).toHaveBeenCalled());
      await act(async () => {});
      await userEvent.setup().click(screen.getByRole("button", { name: "Delete hero.webp" }));
      const dialog = within(await screen.findByRole("alertdialog"));
      expect(dialog.getByText(/In use 1 time/)).toBeTruthy();
      expect(dialog.getByText("/about")).toBeTruthy();
      await userEvent.setup().click(dialog.getByRole("button", { name: "Delete anyway" }));
      await waitFor(() => expect(media.delete).toHaveBeenCalledWith("hero", { force: true }));
    });

    it("a failed delete shows the failure, and still reloads", async () => {
      const media = makeMedia({ usage: undefined, delete: vi.fn(async () => Promise.reject(new Error("no"))) });
      const { onChange } = mount(media);
      await userEvent.setup().click(screen.getByRole("button", { name: "Delete hero.webp" }));
      await answer("Delete");
      expect(await screen.findByText("Delete failed")).toBeTruthy();
      expect(onChange).toHaveBeenCalled();
    });

    it("moves an asset by dropping it on a folder", async () => {
      const media = makeMedia();
      mount(media);
      const data = { types: ["application/x-typren-asset"], getData: () => "hero", setData: vi.fn(), files: [] };
      fireEvent.drop(screen.getByRole("option", { name: "events" }), { dataTransfer: data });
      await waitFor(() => expect(media.folders!.move).toHaveBeenCalledWith("hero", "events"));
    });

    it("renames an asset in place, keeping its folder", async () => {
      const media = makeMedia();
      mount(media, { folder: "events" });
      fireEvent.doubleClick(screen.getByText("pic.webp"));
      const box = screen.getByRole("textbox");
      box.textContent = "photo";
      fireEvent.input(box);
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(media.folders!.move).toHaveBeenCalledWith("pic", "events", "photo"));
    });

    it("renames a root asset with an empty parent", async () => {
      const media = makeMedia();
      mount(media);
      fireEvent.doubleClick(screen.getByText("hero.webp"));
      const box = screen.getByRole("textbox");
      box.textContent = "banner";
      fireEvent.input(box);
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(media.folders!.move).toHaveBeenCalledWith("hero", "", "banner"));
    });

    it("a failed rename or move says so", async () => {
      const media = makeMedia();
      vi.mocked(media.folders!.move).mockRejectedValue(new Error("no"));
      mount(media);
      fireEvent.doubleClick(screen.getByText("hero.webp"));
      const box = screen.getByRole("textbox");
      box.textContent = "banner";
      fireEvent.input(box);
      fireEvent.keyDown(box, { key: "Enter" });
      expect(await screen.findByText("Rename failed")).toBeTruthy();
    });

    it("renames a nested folder and follows it when it is the open one", async () => {
      const media = makeMedia();
      const { onOpenFolder } = mount(media, { folder: "events" });
      fireEvent.doubleClick(screen.getByText("2025"));
      const box = screen.getByRole("textbox");
      box.textContent = "2026";
      fireEvent.input(box);
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(media.folders!.rename).toHaveBeenCalledWith("events/2025", "events/2026"));
      expect(onOpenFolder).not.toHaveBeenCalled();
    });

    it("renames a top-level folder, opening the new path when it was open", async () => {
      const media = makeMedia();
      const { onOpenFolder } = mount(media, { folder: "" });
      fireEvent.doubleClick(screen.getByText("empty"));
      const box = screen.getByRole("textbox");
      box.textContent = "gone";
      fireEvent.input(box);
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(media.folders!.rename).toHaveBeenCalledWith("empty", "gone"));
      expect(onOpenFolder).not.toHaveBeenCalled();
    });

    it("deletes an empty folder", async () => {
      const media = makeMedia();
      mount(media);
      fireEvent.contextMenu(screen.getByText("empty"));
      await userEvent.setup().click(await screen.findByRole("menuitem", { name: /Delete/ }));
      await waitFor(() => expect(media.folders!.delete).toHaveBeenCalledWith("empty"));
    });

    it("offers no move, rename or folder delete without folder support", () => {
      mount(makeMedia({ folders: undefined }), { folders: undefined });
      expect(screen.queryByRole("combobox", { name: /Move/ })).toBeNull();
      fireEvent.doubleClick(screen.getByText("hero.webp"));
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  describe("uploads", () => {
    const drop = () => {
      const file = new File(["x"], "x.png", { type: "image/png" });
      fireEvent.drop(screen.getByRole("listbox", { name: "Assets" }), { dataTransfer: { files: [file], types: [], getData: () => "" } });
    };

    it("dropped files upload into the folder, then reload", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true }));
      vi.stubGlobal("fetch", fetchMock);
      const { onChange } = mount(makeMedia(), { folder: "events" });
      drop();
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith("/upload", expect.objectContaining({ method: "POST" }));
    });

    it("a failed upload shows its error", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Too big" }) })));
      mount(makeMedia());
      drop();
      expect(await screen.findByText(/Too big/)).toBeTruthy();
    });
  });
});

describe("drag and drop", () => {
  const file = new File(["x"], "x.png", { type: "image/png" });
  const dt = (types: string[], data: Record<string, string> = {}, files: File[] = []) => ({ types, files, getData: (t: string) => data[t] ?? "" });
  const overlay = () => document.querySelector("[aria-hidden].pointer-events-none.absolute.inset-2") as HTMLElement;

  it("shows the drop overlay while files hover and hides it after leaving or dropping", () => {
    mount(makeMedia(), { folder: "events" });
    const area = screen.getByRole("listbox");
    expect(overlay().className).toContain("opacity-0");
    fireEvent.dragEnter(area, { dataTransfer: dt(["Files"]) });
    expect(overlay().className).toContain("opacity-100");
    expect(overlay().textContent).toBe("Drop to upload to events");
    fireEvent.dragLeave(area, { dataTransfer: dt(["Files"]) });
    expect(overlay().className).toContain("opacity-0");
    fireEvent.dragEnter(area, { dataTransfer: dt(["Files"]) });
    fireEvent.drop(area, { dataTransfer: dt(["Files"]) });
    expect(overlay().className).toContain("opacity-0");
  });

  it("ignores drags that are not files", () => {
    mount(makeMedia());
    fireEvent.dragEnter(screen.getByRole("listbox"), { dataTransfer: dt(["text/plain"]) });
    expect(overlay().className).toContain("opacity-0");
  });

  it("an asset dropped on a breadcrumb moves it there", async () => {
    const media = makeMedia();
    mount(media, { folder: "events/2025" });
    fireEvent.dragOver(crumbs().getByRole("button", { name: "events" }), { dataTransfer: dt(["application/x-typren-asset"]) });
    expect(crumbs().getByRole("button", { name: "events" }).className).toContain("ring-2");
    fireEvent.drop(crumbs().getByRole("button", { name: "events" }), { dataTransfer: dt(["application/x-typren-asset"], { "application/x-typren-asset": "deep" }) });
    await waitFor(() => expect(media.folders!.move).toHaveBeenCalledWith("deep", "events"));
  });

  it("files dropped on a breadcrumb or a folder tile upload into that folder", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { onChange } = mount(makeMedia(), { folder: "events" });
    fireEvent.drop(crumbs().getByRole("button", { name: "All Assets" }), { dataTransfer: dt(["Files"], {}, [file]) });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0]![1].body as FormData).get("folder")).toBeNull();
    fireEvent.drop(screen.getByRole("option", { name: "2025" }), { dataTransfer: dt(["Files"], {}, [file]) });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1]![1].body as FormData).get("folder")).toBe("events/2025");
  });
});

describe("uploadAssets", () => {
  const files = (...names: string[]) => names.map((n) => new File(["x"], n)) as unknown as FileList;
  const media = makeMedia();

  it("posts each file with its folder and resolves to an empty string", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await uploadAssets(media, files("a.png", "b.png"), "events")).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]![1].body as FormData).get("folder")).toBe("events");
  });

  it("omits the folder field at the root", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadAssets(media, files("a.png"));
    expect((fetchMock.mock.calls[0]![1].body as FormData).has("folder")).toBe(false);
  });

  it("uploads through the host's upload when it has one, never a plain POST", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const upload = vi.fn().mockResolvedValueOnce(assets[0]).mockRejectedValueOnce(new Error("Upload too large"));
    expect(await uploadAssets(makeMedia({ upload }), files("a.png", "b.png"), "events")).toBe("Upload too large");
    expect(upload).toHaveBeenCalledWith(expect.any(File), "events");
    expect(await uploadAssets(makeMedia({ upload: vi.fn().mockRejectedValue("nope") }), files("a.png"))).toBe("nope");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves to the last error, falling back to the status text", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "first" }) })
        .mockResolvedValueOnce({ ok: false, statusText: "Bad Gateway", json: async () => Promise.reject(new Error("no json")) })
    );
    expect(await uploadAssets(media, files("a.png", "b.png"))).toBe("Bad Gateway");
  });
});
