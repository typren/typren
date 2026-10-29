import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavItem, PageActions, PageFlows, PageContent, PageInfo } from "@typren/core";
import { itemError, moveItem, navTarget } from "./nav-panel";
import { TyprenStudio, type TyprenStudioHost } from "./typren-studio";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Autosave's 0.8s debounce, driven by hand. Only setTimeout is faked, and
// only once the screen has loaded: Testing Library's waitFor and findBy wait
// on real timers, so they stay out of the faked stretch.
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
/** The menu and the top bar's controls, which settle in on timers of their own. */
const loaded = async (control: string) => {
  await waitFor(() => expect(rowNames()).toHaveLength(3));
  await screen.findByRole("button", { name: control });
};
const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const a = { label: "A", href: "/a" };
const b = { label: "B", href: "/b" };
const c = { label: "C", href: "#", children: [{ label: "C1", href: "/c1" }] };

describe("menu tree", () => {
  it("moves items before, after and inside, keeping the moved item itself", () => {
    const nav: NavItem[] = [a, b, c];
    expect(moveItem(nav, [0], [1], "after")).toEqual([b, a, c]);
    expect(moveItem(nav, [1], [0], "before")).toEqual([b, a, c]);
    const nested = moveItem(nav, [0], [1], "inside");
    expect(nested).toEqual([{ ...b, children: [a] }, c]);
    expect(nested[0]!.children![0]).toBe(a);
    // Out of a submenu: the emptied parent loses its `children` key.
    expect(moveItem(nav, [2, 0], [2], "after")).toEqual([a, b, { label: "C", href: "#" }, c.children[0]]);
    expect(moveItem(nav, [0], [2, 0], "before")).toEqual([b, { ...c, children: [a, c.children[0]] }]);
  });

  it("refuses moves that would nest deeper than one level, and no-ops", () => {
    const nav: NavItem[] = [a, b, c];
    expect(moveItem(nav, [2], [0], "inside")).toBe(nav);
    expect(moveItem(nav, [2], [2, 0], "before")).toBe(nav);
    expect(moveItem(nav, [0], [2, 0], "inside")).toBe(nav);
    expect(moveItem(nav, [0], [0], "after")).toBe(nav);
    expect(moveItem(nav, [9], [0], "after")).toBe(nav);
  });

  it("matches internal links to a page path", () => {
    expect(navTarget({ href: "/about/?x=1#y" })).toBe("/about");
    expect(navTarget({ href: "/" })).toBe("/");
    expect(navTarget({ href: "/about", external: true })).toBeNull();
    expect(navTarget({ href: "//evil.example" })).toBeNull();
    expect(navTarget({ href: "#" })).toBeNull();
  });

  it("explains invalid items", () => {
    expect(itemError({ label: " ", href: "/a" })).toBe("Enter a label.");
    expect(itemError({ label: "x", href: "javascript:alert(1)" })).toMatch(/https/);
    expect(itemError({ label: "x", href: 3 } as unknown as NavItem)).toBe("Enter a link.");
    expect(itemError(a)).toBeNull();
  });
});

const pages: PageInfo[] = [
  { slug: "home", title: "Home", hasDraft: false, locales: ["en"] },
  { slug: "about", title: "About", hasDraft: false, locales: ["en"] },
];
const siteDoc = (meta: Record<string, unknown>): PageContent => ({ meta, slices: [], body: "" });

function setup({ meta, hasDraft = false, git = false }: { meta?: Record<string, unknown>; hasDraft?: boolean; git?: boolean } = {}) {
  // The site doc's draft mark follows the writes, as the store's would.
  let drafted = hasDraft;
  const actions = {
    saveDraft: vi.fn(async () => ((drafted = true), { ok: true as const, version: "v2" })),
    publish: vi.fn(async () => ((drafted = false), { ok: true as const, version: "v3" })),
    discardDraft: vi.fn(async () => void (drafted = false)),
    deletePage: vi.fn(async () => {}),
  };
  const getPage = vi.fn(async () => ({
    page: siteDoc(meta ?? { title: "Site", nav: [{ label: "About", href: "/about" }, c], cta: { label: "Contact", href: "/contact" } }),
    version: "v1",
    hasDraft: drafted,
  }));
  const gitHost = {
    outgoing: vi.fn(async () => ({ branch: "main", upstream: "origin/main", commits: [] })),
    pending: vi.fn(async () => [
      { path: "content/site.md", change: "modified" as const, commits: [{ hash: "abc1234", subject: "content: update site" }] },
      { path: "content/about.md", change: "added" as const, commits: [{ hash: "def5678", subject: "content: add about" }] },
    ]),
    push: vi.fn<(paths: string[], slugs?: string[]) => Promise<void>>(async () => {}),
    discard: vi.fn<(paths: string[]) => Promise<void>>(async () => {}),
  };
  const host: TyprenStudioHost = {
    actions: actions as unknown as PageActions & PageFlows,
    sliceNames: [],
    defaults: {},
    previewPath: "/preview",
    getPage,
    git: git ? gitHost : undefined,
    sections: [
      { kind: "pages", label: "Pages" },
      { kind: "custom", id: "navigation", label: "Navigation", host: true },
    ],
  };
  const onReload = vi.fn();
  const onNavigateSection = vi.fn();
  render(
    <TyprenStudio host={host} pages={pages} sectionId="navigation" onNavigate={() => {}} onReload={onReload} onNavigateSection={onNavigateSection} />
  );
  return { actions, getPage, gitHost, onReload, onNavigateSection };
}

const menu = () => screen.getByRole("list", { name: "Menu" });
const rowNames = () => within(menu()).getAllByRole("button").map((r) => r.textContent);
const iconOf = (text: HTMLElement) => text.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("Navigation screen", () => {
  it("holds the rail and panel's space with skeletons while the menu loads, then swaps them out", async () => {
    setup();
    const busy = () => [...document.querySelectorAll('[aria-busy="true"]')];
    // The rail's rows and the panel/preview cards: both reserve their space at once.
    expect(busy()).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(5);
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(busy()).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it("shows the menu tree, the button and a preview, editable at once", async () => {
    const { getPage } = setup();
    await waitFor(() => expect(rowNames()).toEqual(["About", "C", "C1"]));
    expect(getPage).toHaveBeenCalledWith("site");
    expect(screen.getByText("Contact")).toBeTruthy();
    expect(screen.getByTitle("Live preview").getAttribute("src")).toMatch(/^\/preview\/home\?v=/);
    expect(screen.getAllByText("Up to date")[0]).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "About" }));
    expect((screen.getByLabelText("Label") as HTMLInputElement).disabled).toBe(false);
    expect(button("Add menu item")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    // Rows are draggable and reserve no icon slot; the grip is an overlay.
    const li = within(menu()).getByRole("button", { name: "About" }).closest("li")!;
    expect(li.getAttribute("draggable")).toBe("true");
    const grip = li.querySelector("svg")!;
    expect(grip.parentElement).toBe(li);
    expect(grip.getAttribute("class")).toMatch(/absolute.*opacity-0/);
    expect(li.querySelector("button svg")).toBeNull();
  });

  it("holds an invalid link out of the draft and off Publish", async () => {
    const { actions } = setup();
    await loaded("Publish");
    fakeTimers();
    fireEvent.click(button("Add menu item"));
    expect(rowNames()).toEqual(["About", "C", "C1", "New link"]);
    typeIn("Link", "javascript:alert(1)");
    expect(screen.getByRole("alert").textContent).toMatch(/https/);
    expect(button("Publish").disabled).toBe(true);
    // Publish leads; the save status sits at the bar's edge after it.
    expect(button("Publish").compareDocumentPosition(screen.getAllByText("Saving…").at(-1)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await tick(2000);
    expect(actions.saveDraft).not.toHaveBeenCalled();
  });

  it("autosaves 0.8s after the last edit, then Publish saves what is left and publishes", async () => {
    const { actions, onReload } = setup();
    await loaded("Publish");
    fakeTimers();
    fireEvent.click(button("Add menu item"));
    typeIn("Label", "Docs");
    typeIn("Link", "https://docs.example");
    fireEvent.click(screen.getByLabelText("External link"));
    await tick(799);
    expect(actions.saveDraft).not.toHaveBeenCalled();
    await tick(1);
    const saved = { title: "Site", nav: [{ label: "About", href: "/about" }, c, { label: "Docs", href: "https://docs.example", external: true }], cta: { label: "Contact", href: "/contact" } };
    expect(actions.saveDraft).toHaveBeenCalledOnce();
    expect(actions.saveDraft).toHaveBeenCalledWith("site", siteDoc(saved), "v1", undefined);
    expect(screen.getByText("Saved just now")).toBeTruthy();

    // Unticking drops the key rather than writing `external: undefined`;
    // Publish saves it first, then publishes at the saved version.
    fireEvent.click(screen.getByLabelText("External link"));
    fireEvent.click(button("Publish"));
    await tick(0);
    expect(actions.saveDraft).toHaveBeenLastCalledWith(
      "site",
      siteDoc({ ...saved, nav: [saved.nav[0], c, { label: "Docs", href: "https://docs.example" }] }),
      "v2",
      undefined
    );
    expect(actions.publish).toHaveBeenCalledWith("site", "v2", undefined);
    expect(onReload).toHaveBeenCalled();
    expect(screen.getByText("Published")).toBeTruthy();
  });
  it("moves, nests and removes items from the item panel, and edits the button", async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    await user.click(screen.getByRole("button", { name: "C1" }));
    await user.click(button("Move out of the submenu"));
    expect(rowNames()).toEqual(["About", "C", "C1"]);
    expect(button("Move down").disabled).toBe(true);
    await user.click(button("Move up"));
    await user.click(button("Move up"));
    expect(rowNames()).toEqual(["C1", "About", "C"]);
    await user.click(button("Move down"));
    expect(rowNames()).toEqual(["About", "C1", "C"]);
    await user.click(button("Move into the item above"));
    expect(rowNames()).toEqual(["About", "C1", "C"]);
    expect(within(menu()).getByRole("button", { name: "C1" }).closest("li")!.className).toContain("ml-5");
    await user.click(button("Remove item"));
    expect(rowNames()).toEqual(["About", "C"]);
    expect(iconOf(screen.getByText(/Select a menu item/))).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Contact" }));
    expect(screen.queryByRole("button", { name: "Remove item" })).toBeNull();
    const label = screen.getByLabelText("Label");
    await user.clear(label);
    expect(screen.getByRole("alert").textContent).toBe("Enter a label.");
    expect(within(screen.getByRole("navigation", { name: "Studio" })).getByRole("button", { name: "Untitled" })).toBeTruthy();
  });

  it("drags a row before, after or into another", async () => {
    setup();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    const li = (name: string) => within(menu()).getByRole("button", { name }).closest("li")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 0, height: 40 } as DOMRect);
    // jsdom has no DragEvent, so the pointer position rides on a MouseEvent.
    const over = (name: string, clientY: number) => fireEvent(li(name), new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY }));
    const drag = (from: string, to: string, y: number) => {
      fireEvent.dragStart(li(from));
      over(to, y);
      fireEvent.drop(li(to));
    };
    drag("C", "About", 2);
    expect(rowNames()).toEqual(["C", "C1", "About"]);
    drag("C", "About", 38);
    expect(rowNames()).toEqual(["About", "C", "C1"]);
    drag("About", "C", 20);
    expect(rowNames()).toEqual(["C", "C1", "About"]);
    // A submenu row has no middle: its lower half drops after it.
    fireEvent.dragStart(li("About"));
    over("C1", 25);
    expect(li("C1").className).toContain("inset_0_-2px");
    fireEvent.dragLeave(li("C1"));
    fireEvent.dragEnd(li("About"));
    expect(rowNames()).toEqual(["C", "C1", "About"]);
  });

  it("steps a row among its siblings with Alt+Arrow", async () => {
    setup();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    const row = (name: string) => within(menu()).getByRole("button", { name });
    fireEvent.keyDown(row("C"), { key: "ArrowUp", altKey: true });
    expect(rowNames()).toEqual(["C", "C1", "About"]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("C"));
    // The first sibling, and the only child, stay put.
    fireEvent.keyDown(row("C"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(row("C1"), { key: "ArrowDown", altKey: true });
    expect(rowNames()).toEqual(["C", "C1", "About"]);
  });

  it("discards the draft after a confirm and reloads the doc", async () => {
    const user = userEvent.setup();
    const { actions, getPage } = setup({ hasDraft: true });
    await screen.findByText("Unpublished changes");
    await screen.findByRole("button", { name: "Discard" });
    await user.click(button("Discard"));
    await answer("Cancel");
    expect(actions.discardDraft).not.toHaveBeenCalled();
    await user.click(button("Discard"));
    await answer("Discard");
    await waitFor(() => expect(actions.discardDraft).toHaveBeenCalledWith("site", undefined));
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowNames()).toHaveLength(3));
  });

  it("shows a conflict with Reload, and a save error, never Saved", async () => {
    const { actions, getPage } = setup();
    await loaded("Publish");
    fakeTimers();
    actions.saveDraft.mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: "v9" } as never);
    fireEvent.click(button("Add menu item"));
    await tick(800);
    expect(screen.getByRole("alert").textContent).toMatch(/Someone else changed/);
    expect(screen.getByText("Not saved: changed elsewhere")).toBeTruthy();
    vi.useRealTimers();
    fireEvent.click(button("Reload"));
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    fakeTimers();
    actions.saveDraft.mockRejectedValueOnce(new Error("typren: navigation link refused"));
    fireEvent.click(button("Add menu item"));
    await tick(800);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn’t save the menu.*refused/);
    expect(screen.getByText("Not saved")).toBeTruthy();
  });
  it("saves before leaving, and asks only when that save fails", async () => {
    const user = userEvent.setup();
    const { actions, onNavigateSection } = setup();
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    await user.click(button("Add menu item"));
    await user.click(button("Website"));
    await waitFor(() => expect(onNavigateSection).toHaveBeenCalledWith(null));
    expect(actions.saveDraft).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before leaving when the save fails, and stays when declined", async () => {
    const user = userEvent.setup();
    const { actions, onNavigateSection } = setup();
    actions.saveDraft.mockRejectedValue(new Error("offline"));
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    await user.click(button("Add menu item"));
    await user.click(button("Website"));
    await answer("Cancel");
    expect(onNavigateSection).not.toHaveBeenCalled();
    await user.click(button("Website"));
    await answer("Leave");
    await waitFor(() => expect(onNavigateSection).toHaveBeenCalledWith(null));
  });
  it("autosaves in a local checkout, and Review lists the menu's draft to push as its own commit", async () => {
    const user = userEvent.setup();
    const { actions, gitHost, getPage, onReload } = setup({ git: true });
    await loaded("Review");
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    fakeTimers();
    fireEvent.click(button("Add menu item"));
    await tick(800);
    expect(actions.saveDraft).toHaveBeenCalled();
    expect(screen.getAllByText("Not pushed")[0]).toBeTruthy();
    vi.useRealTimers();
    await user.click(button("Review"));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    expect(within(dialog).queryByText("Changes not yet saved here are not included.")).toBeNull();
    expect(await within(dialog).findByText("Menu")).toBeTruthy();
    expect(within(dialog).getByRole("checkbox", { name: /About/ })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Push selected" }));
    await waitFor(() => expect(gitHost.push).toHaveBeenCalledWith(["content/site.md", "content/about.md"], ["site"]));
    // A push publishes drafts, so the host reads its pages again.
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    onReload.mockClear();

    // The pushed draft left the list; the menu read its doc again.
    await waitFor(() => expect(within(dialog).queryByText("Menu")).toBeNull());
    expect(getPage.mock.calls.length).toBeGreaterThan(1);
  });

  it("drops the menu's draft from Review, and the menu reads its doc again", async () => {
    const user = userEvent.setup();
    const { actions, getPage, onReload } = setup({ git: true, hasDraft: true });
    await user.click(await screen.findByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    await within(dialog).findByText("Menu");
    const reads = getPage.mock.calls.length;
    await user.click(within(dialog).getAllByRole("button", { name: "Discard Navigation" })[0]!);
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(actions.discardDraft).toHaveBeenCalledWith("site", undefined));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    await waitFor(() => expect(getPage.mock.calls.length).toBeGreaterThan(reads));
  });
  it("says the menu is managed in code without a site doc or its nav list, with a docs link", async () => {
    setup({ meta: { title: "Site" } });
    expect(await screen.findByText(/managed in its code/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /navigation doc/ }).getAttribute("href")).toBe("https://typren.com/docs/navigation");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("tells a missing site doc from a failed read", async () => {
    for (const [error, text] of [
      [Object.assign(new Error("Not found"), { status: 404 }), /managed in its code/],
      [new Error("offline"), /offline/],
    ] as const) {
      const host: TyprenStudioHost = {
        actions: {} as PageActions & PageFlows,
        sliceNames: [],
        defaults: {},
        previewPath: "/preview",
        getPage: vi.fn(async () => {
          throw error;
        }),
        sections: [{ kind: "custom", id: "navigation", label: "Navigation", host: true }],
      };
      render(<TyprenStudio host={host} pages={pages} sectionId="navigation" onNavigate={() => {}} onReload={() => {}} />);
      expect(iconOf(await screen.findByText(text))).toBeTruthy();
      if (error.message === "offline") {
        fireEvent.click(button("Reload"));
        await waitFor(() => expect(host.getPage).toHaveBeenCalledTimes(2));
      }
      cleanup();
    }
    render(
      <TyprenStudio
        host={{ actions: {} as PageActions & PageFlows, sliceNames: [], defaults: {}, previewPath: "/p", sections: [{ kind: "custom", id: "navigation", label: "Navigation", host: true }] }}
        pages={pages}
        sectionId="navigation"
        onNavigate={() => {}}
        onReload={() => {}}
      />
    );
    expect(await screen.findByText(/managed in its code/)).toBeTruthy();
  });
});
