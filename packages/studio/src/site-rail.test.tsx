import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSections, type MediaAsset, type PageInfo } from "@typren/core";
import { PortalContext } from "./primitives/portal";
import { AssetsLevel, PagesLevel, SiteLevel, groupPages, pageTree, railGroups } from "./site-rail";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const p = (slug: string, extra: Partial<PageInfo> = {}): PageInfo => ({
  slug,
  title: slug,
  hasDraft: false,
  locales: ["en"],
  ...extra,
});

describe("groupPages", () => {
  it("splits nav, other, hidden, system and draft pages, ordering nav by navOrder with unordered last", () => {
    const g = groupPages([
      p("blog", { nav: true }),
      p("about", { nav: true, navOrder: 2 }),
      p("home", { nav: true, navOrder: 1 }),
      p("terms"),
      p("thanks", { noindex: true, nav: true }),
      p("404", { system: true, nav: true, noindex: true }),
      p("sandbox", { published: false, nav: true, noindex: true, hasDraft: true }),
    ]);
    expect(g.main.map((x) => x.slug)).toEqual(["home", "about", "blog"]);
    expect(g.other.map((x) => x.slug)).toEqual(["terms"]);
    expect(g.hidden.map((x) => x.slug)).toEqual(["thanks"]);
    expect(g.system.map((x) => x.slug)).toEqual(["404"]);
    expect(g.drafts.map((x) => x.slug)).toEqual(["sandbox"]);
  });
});

describe("pageTree", () => {
  it("nests by slug segment, with folder nodes for paths that have no page", () => {
    const tree = pageTree([p("event/1"), p("about"), p("event/2"), p("docs/guides/start")], ["event", "empty"]);
    const shape = (nodes: ReturnType<typeof pageTree>): unknown =>
      nodes.map((n) => [n.segment, n.page ? "page" : "folder", ...(n.children.length ? [shape(n.children)] : [])]);
    expect(shape(tree)).toEqual([
      ["event", "folder", [["1", "page"], ["2", "page"]]],
      ["about", "page"],
      ["docs", "folder", [["guides", "folder", [["start", "page"]]]]],
      ["empty", "folder"],
    ]);
  });

  it("keeps a page that has children as a page node", () => {
    const [event] = pageTree([p("event"), p("event/1")]);
    expect(event.page?.slug).toBe("event");
    expect(event.children.map((c) => c.path)).toEqual(["event/1"]);
  });
});

describe("PagesLevel", () => {
  const pages = [
    p("home", { nav: true, navOrder: 1 }),
    p("event", { nav: true }),
    p("event/1", { hasDraft: true }),
    p("event/2"),
    p("thanks", { noindex: true }),
    p("sandbox", { published: false, hasDraft: true, title: "Sandbox" }),
  ];
  const mount = (props: Partial<Parameters<typeof PagesLevel>[0]> = {}) => {
    const fns = {
      onNew: vi.fn(),
      onDelete: vi.fn(async () => {}),
      onDeleteFolder: vi.fn(async () => {}),
      onNavigate: vi.fn(),
    };
    render(
      <PortalContext.Provider value={document.body}>
        <PagesLevel pages={pages} homeSlug="home" {...fns} {...props} />
      </PortalContext.Provider>
    );
    return fns;
  };

  it("renders the groups in order and expands a page's children", async () => {
    const user = userEvent.setup();
    mount();
    const labels = ["In navigation", "Not in navigation", "Hidden from search", "Drafts"];
    expect(screen.getAllByRole("button").map((b) => b.textContent).filter((t) => labels.includes(t ?? ""))).toEqual(labels);
    // Not in navigation holds event/1 and event/2 under a folder, since `event` itself is in navigation.
    expect(screen.queryByRole("button", { name: "event/1" })).toBeNull();
    const [page, folder] = screen.getAllByRole("button", { name: "event" });
    expect(page.getAttribute("aria-expanded")).toBeNull();
    await user.click(folder);
    expect(screen.getByRole("button", { name: "event/1" })).toBeTruthy();
    // The draft dot marks a pending draft on a published page, not a draft-only page.
    expect(screen.getAllByTitle("Has draft")).toHaveLength(1);
  });

  it("pins the home page first, outside every group, whatever its nav status", () => {
    mount();
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rows[1]).toBe("home"); // after New page
    expect(rows.indexOf("In navigation")).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: /^home/ })).toHaveLength(1);
    expect(screen.getByLabelText("Home page")).toBeTruthy();
  });

  it("opens the branch holding the current page", () => {
    mount({ currentSlug: "event/2" });
    expect(screen.getByRole("button", { name: "event/2" })).toBeTruthy();
  });

  it("toggles a page's children from its chevron", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    mount({ pages: [p("event"), p("event/1")], onNavigate });
    expect(screen.queryByRole("button", { name: "event/1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pages under event" }));
    await user.click(screen.getByRole("button", { name: "event/1" }));
    expect(onNavigate).toHaveBeenCalledWith("event/1");
  });

  it("opens the new-page wizard from its +, and has no + without one", async () => {
    const fns = mount();
    await userEvent.setup().click(screen.getByRole("button", { name: "New page" }));
    expect(fns.onNew).toHaveBeenCalledOnce();
    cleanup();
    mount({ onNew: undefined });
    expect(screen.queryByRole("button", { name: "New page" })).toBeNull();
  });

  it("shows kept folders and deletes one only while it is empty", async () => {
    const user = userEvent.setup();
    const fns = mount({ folders: ["events", "event"] });
    expect(screen.getByRole("button", { name: "events" })).toBeTruthy();
    // `event` holds pages, so it offers no delete.
    expect(screen.queryByRole("button", { name: "Delete folder event" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete folder events" }));
    await answer("Delete");
    await waitFor(() => expect(fns.onDeleteFolder).toHaveBeenCalledWith("events"));
  });

  it("deletes a page from its settings popover after confirming", async () => {
    const user = userEvent.setup();
    const fns = mount();
    await user.click(screen.getByRole("button", { name: "Settings for thanks" }));
    await user.click(await screen.findByRole("button", { name: "Delete page" }));
    expect(within(await screen.findByRole("alertdialog")).getByText("Delete page “thanks”? This cannot be undone.")).toBeTruthy();
    await answer("Cancel");
    expect(fns.onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Settings for thanks" }));
    await user.click(await screen.findByRole("button", { name: "Delete page" }));
    await answer("Delete");
    await waitFor(() => expect(fns.onNavigate).toHaveBeenCalledWith(null));
    expect(fns.onDelete).toHaveBeenCalledWith("thanks");
  });

  it("covers the end adornment with the settings button, reserving the slot so nothing reflows", () => {
    mount();
    const row = screen.getByRole("button", { name: "home" });
    const adornment = screen.getByLabelText("Home page").parentElement!;
    const settings = screen.getByRole("button", { name: "Settings for home" });
    // Both sit in one grid cell: the adornment fades out as the button fades in.
    expect(adornment.parentElement).toBe(settings.parentElement);
    expect(adornment.className).toContain("group-hover/row:opacity-0");
    expect(adornment.className).toContain("group-focus-within/row:opacity-0");
    expect(settings.className).toContain("opacity-0");
    expect(settings.className).toContain("group-hover/row:opacity-100");
    expect(settings.className).toContain("duration-150");
    expect(settings.className).toContain("motion-reduce:transition-none");
    // The slot is reserved up front, never on hover.
    expect(row.className).toContain("pr-10");
    expect(document.body.innerHTML).not.toMatch(/group-hover\/row:pr-/);
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("offers settings for a page and follows a rename of the open page", async () => {
    const user = userEvent.setup();
    const settingsIO = {
      load: vi.fn(async () => ({ page: { meta: { title: "Day one" }, slices: [], body: "" }, version: "v1" })),
      updateMeta: vi.fn(async () => ({ ok: true as const, version: "v2" })),
      rename: vi.fn(async (_s: string, to: string) => ({ ok: true as const, slug: to })),
    };
    const fns = mount({ settingsIO, currentSlug: "event/1" });
    await user.click(screen.getByRole("button", { name: "Settings for event/1" }));
    const slug = await screen.findByLabelText("Slug");
    // Siblings under event/ are checked, not the top level.
    await user.clear(slug);
    await user.type(slug, "2");
    expect(screen.getByRole("alert").textContent).toBe("That slug is already used here.");
    await user.clear(slug);
    await user.type(slug, "about");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(settingsIO.rename).toHaveBeenCalledWith("event/1", "event/about"));
    expect(fns.onNavigate).toHaveBeenCalledWith("event/about");
    expect(settingsIO.updateMeta).not.toHaveBeenCalled();
  });
});

describe("railGroups", () => {
  it("puts Pages under Website first, then the other groups in config order", () => {
    const groups = railGroups(
      resolveSections({
        sections: [
          { kind: "settings", label: "Settings" },
          { kind: "media", label: "Media" },
          { kind: "pages", label: "Pages" },
          { kind: "custom", label: "Style", group: "website", host: true },
          { kind: "custom", label: "Shop", group: "commerce", host: true },
        ],
      })
    );
    expect(groups.map((g) => [g.label, g.items.map((s) => s.label)])).toEqual([
      ["Website", ["Pages", "Style"]],
      ["Other", ["Settings"]],
      ["Content", ["Media"]],
      ["Commerce", ["Shop"]],
    ]);
  });

  it("drops an empty Website group", () => {
    const groups = railGroups(resolveSections({ sections: [{ kind: "media", label: "Media" }] }));
    expect(groups.map((g) => g.label)).toEqual(["Content"]);
  });
});

describe("AssetsLevel", () => {
  const asset = (id: string, folder = ""): MediaAsset => ({ id, url: `/${id}`, name: id, size: 1, mime: "image/webp", createdAt: "2026-01-01", folder });
  const assets = [asset("a"), asset("b", "events"), asset("c", "events/2025")];
  const folders = ["events", "events/2025", "empty"];
  const mount = (props: Partial<Parameters<typeof AssetsLevel>[0]> = {}) => {
    const fns = {
      onOpen: vi.fn(),
      onCreate: vi.fn(async () => {}),
      onUpload: vi.fn(),
      onRename: vi.fn(async () => {}),
      onDelete: vi.fn(async () => {}),
      onMove: vi.fn(),
    };
    render(
      <PortalContext.Provider value={document.body}>
        <AssetsLevel folders={folders} assets={assets} current="" {...fns} {...props} />
      </PortalContext.Provider>
    );
    return fns;
  };
  const type = (box: HTMLElement, text: string) => {
    box.textContent = text;
    fireEvent.input(box);
  };
  const events = () => screen.getByRole("button", { name: /^events\s*2$/ });
  const empty = () => screen.getByRole("button", { name: /^empty/ });
  const dnd = { types: ["application/x-typren-asset"], getData: () => "a" };

  it("lists All Assets and every folder with counts, marking the current one", () => {
    mount({ current: "events" });
    expect(screen.getByRole("button", { name: /All Assets/ }).textContent).toContain("3");
    expect(events().getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /^2025/ }).textContent).toContain("1");
    expect(empty().textContent).toContain("0");
  });

  it("is All Assets alone when the adapter has no folders", () => {
    mount({ folders: undefined, onCreate: undefined });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("clicking a row opens that folder", async () => {
    const { onOpen } = mount();
    await userEvent.setup().click(empty());
    expect(onOpen).toHaveBeenCalledWith("empty");
  });

  it("the plus menu uploads through the hidden input", async () => {
    const { onUpload } = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add to assets" }));
    await user.click(await screen.findByRole("button", { name: /Upload/ }));
    const input = screen.getByLabelText("Upload images") as HTMLInputElement;
    await user.upload(input, new File(["x"], "x.png", { type: "image/png" }));
    expect(onUpload).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { files: [] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("New folder validates live, disables Add, and creates then opens the folder", async () => {
    const { onCreate, onOpen } = mount({ current: "events" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add to assets" }));
    await user.click(await screen.findByRole("button", { name: /New folder/ }));
    const input = screen.getByPlaceholderText("Folder in events");
    const add = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await user.type(input, "Bad Name");
    expect(screen.getByRole("alert").textContent).toBe("Use lowercase letters.");
    expect(add.disabled).toBe(true);
    await user.keyboard("{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "2025");
    expect(screen.getByRole("alert").textContent).toMatch(/already used/);
    await user.clear(input);
    await user.type(input, "party");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(add);
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("events/party"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("events/party"));
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("creates at the top level with Enter, and Escape cancels the input", async () => {
    const { onCreate } = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add to assets" }));
    await user.click(await screen.findByRole("button", { name: /New folder/ }));
    await user.type(screen.getByPlaceholderText("Folder name"), "fresh{Enter}");
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("fresh"));
    await user.click(screen.getByRole("button", { name: "Add to assets" }));
    await user.click(await screen.findByRole("button", { name: /New folder/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText("Folder name")).toBeNull();
  });

  it("offers no New folder without onCreate", async () => {
    mount({ onCreate: undefined });
    await userEvent.setup().click(screen.getByRole("button", { name: "Add to assets" }));
    expect(await screen.findByRole("button", { name: /Upload/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
  });

  it("renames a folder on double-click and follows it when it holds the current one", async () => {
    const { onRename, onOpen } = mount({ current: "events/2025" });
    fireEvent.doubleClick(events());
    const box = screen.getByRole("textbox", { name: "Rename events" });
    type(box, "empty");
    expect(screen.getByRole("alert")).toBeTruthy();
    type(box, "shows");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("events", "shows"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("shows/2025"));
  });

  it("renames a nested folder under its parent without moving the view", async () => {
    const { onRename, onOpen } = mount();
    fireEvent.doubleClick(screen.getByRole("button", { name: /^2025/ }));
    const box = screen.getByRole("textbox");
    type(box, "2026");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("events/2025", "events/2026"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("cancelling a rename, All Assets and rename-less rows do nothing", () => {
    const { onRename } = mount();
    fireEvent.doubleClick(screen.getByRole("button", { name: /All Assets/ }));
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.doubleClick(empty());
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    cleanup();
    mount({ onRename: undefined });
    fireEvent.doubleClick(empty());
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renames from the right-click menu", async () => {
    mount();
    fireEvent.contextMenu(empty());
    await userEvent.setup().click(await screen.findByRole("menuitem", { name: /Rename/ }));
    expect(await screen.findByRole("textbox", { name: "Rename empty" })).toBeTruthy();
  });

  it("deletes an empty folder after confirming, and steps out when it was open", async () => {
    const { onDelete, onOpen } = mount({ current: "empty" });
    expect(screen.queryByRole("button", { name: "Delete folder events" })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete folder empty" }));
    expect(within(await screen.findByRole("alertdialog")).getByText('Delete the empty folder "empty"?')).toBeTruthy();
    await answer("Cancel");
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete folder empty" }));
    await answer("Delete");
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("empty"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(""));
  });

  it("deletes from the context menu only when empty", async () => {
    const { onDelete } = mount();
    const user = userEvent.setup();
    fireEvent.contextMenu(events());
    await screen.findByRole("menuitem", { name: /Rename/ });
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    fireEvent.contextMenu(empty());
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await answer("Delete");
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("empty"));
  });

  it("without onDelete there is no delete button", () => {
    mount({ onDelete: undefined });
    expect(screen.queryByRole("button", { name: /Delete folder/ })).toBeNull();
  });

  it("dropping an asset on a row moves it there", () => {
    const { onMove } = mount();
    const row = empty().closest("li")!;
    fireEvent.dragOver(row, { dataTransfer: dnd });
    expect(empty().className.split(" ")).toContain("ring-2");
    fireEvent.dragLeave(row);
    fireEvent.drop(row, { dataTransfer: dnd });
    expect(onMove).toHaveBeenCalledWith("a", "empty");
    fireEvent.drop(row, { dataTransfer: { types: [], getData: () => "" } });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("ignores foreign drags, and drops without onMove", () => {
    mount({ onMove: undefined });
    const row = empty().closest("li")!;
    fireEvent.dragOver(row, { dataTransfer: dnd });
    fireEvent.drop(row, { dataTransfer: dnd });
    expect(empty().className.split(" ")).not.toContain("ring-2");
    cleanup();
    mount();
    fireEvent.dragOver(empty().closest("li")!, { dataTransfer: { types: ["text/plain"], getData: () => "" } });
    expect(empty().className.split(" ")).not.toContain("ring-2");
  });
});

describe("SiteLevel", () => {
  it("gives every section an icon, keeping one the host supplied", () => {
    const sections = resolveSections({
      sections: [
        { kind: "pages", label: "Pages" },
        { kind: "media", label: "Assets" },
        { kind: "custom", id: "style", label: "Style", host: true },
        { kind: "custom", id: "extra", label: "Extra", host: true },
        { kind: "settings", label: "Settings", icon: <b data-testid="own">S</b> },
      ],
    });
    render(<SiteLevel sections={sections} onOpen={() => {}} />);
    for (const name of ["Pages", "Assets", "Style", "Extra"])
      expect(screen.getByRole("button", { name }).querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Settings/ }).querySelector("svg")).toBeNull();
    expect(screen.getByTestId("own")).toBeTruthy();
  });
});
