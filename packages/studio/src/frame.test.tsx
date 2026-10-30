import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Frame, type FrameSearch } from "./frame";

afterEach(cleanup);

const hits: FrameSearch["hits"] = [
  { id: "page:about", group: "Pages", label: "About" },
  { id: "page:terms", group: "Pages", label: "Terms" },
  { id: "asset:a", group: "Assets", label: "about.webp" },
];

const frame = (props: Partial<Pick<Parameters<typeof Frame>[0], "level" | "view" | "screen" | "pill" | "search">> = {}) => (
  <Frame back={null} level={1} rail={<p>rail</p>} device="desktop" onDevice={() => {}} dark={false} onToggleTheme={() => {}} {...props}>
    <p>main</p>
  </Frame>
);

describe("Frame search", () => {
  it("is the pill itself: shows the page at rest and lists matches as you type", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(frame({ pill: { title: "Home", url: "/", status: "Published" }, search: { hits, onOpen, onPick: vi.fn() } }));
    const box = screen.getByRole("combobox", { name: /^Search/ });
    expect(box.parentElement!.textContent).toContain("Home");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.type(box, "abo");
    expect(onOpen).toHaveBeenCalled();
    expect(box.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["About", "about.webp"]);
    expect(screen.getByText("Assets")).toBeTruthy();
  });

  it("moves through matches with the arrows and opens the highlighted one on Enter", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(frame({ search: { hits, onPick } }));
    const box = screen.getByRole("combobox", { name: /^Search/ });
    await user.click(box);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(box.getAttribute("aria-activedescendant")).toBe("typren-search-1");
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(hits[1]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picks with the mouse, says when nothing matches, clears then leaves on Escape", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(frame({ search: { hits, onPick } }));
    const box = screen.getByRole("combobox", { name: /^Search/ });
    await user.type(box, "zzz");
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onPick).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect((box as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("listbox")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((box as HTMLInputElement).value).toBe("");

    await user.type(box, "terms");
    const option = screen.getByRole("option", { name: "Terms" });
    fireEvent.mouseEnter(option);
    expect(option.getAttribute("aria-selected")).toBe("true");
    await user.click(option);
    expect(onPick).toHaveBeenCalledWith(hits[1]);
  });
});

describe("Frame motion", () => {
  const animate = vi.fn();
  beforeEach(() => {
    animate.mockClear();
    Element.prototype.animate = animate as never;
  });

  const durations = () => animate.mock.calls.map(([, opts]) => (opts as KeyframeAnimationOptions).duration);

  it("slides the rail on a depth change and on a sideways switch at the same depth", () => {
    const { rerender } = render(frame({ level: 0 }));
    animate.mockClear();
    rerender(frame({ level: 1, view: "pages" }));
    expect(durations()).toEqual([560, 560]);
    animate.mockClear();
    rerender(frame({ level: 1, view: "assets" }));
    expect(durations()).toEqual([560, 560]);
    animate.mockClear();
    rerender(frame({ level: 1, view: "assets" }));
    expect(animate).not.toHaveBeenCalled();
  });

  it("keeps the collapse button and theme picker still while the rail slides", () => {
    const { rerender } = render(frame({ level: 0 }));
    animate.mockClear();
    rerender(frame({ level: 1, view: "pages" }));
    const moved = animate.mock.contexts as Element[];
    expect(moved).toHaveLength(2);
    for (const still of [screen.getByRole("button", { name: "Collapse sidebar" }), screen.getByRole("group", { name: "Studio theme" })])
      expect(moved.some((el) => el.contains(still))).toBe(false);
  });

  it("fades the main area in when the screen changes, not between preview pages", () => {
    const { rerender } = render(frame({ screen: "preview" }));
    animate.mockClear();
    rerender(frame({ screen: "preview" }));
    expect(animate).not.toHaveBeenCalled();
    rerender(frame({ screen: "media" }));
    expect(durations()).toEqual([420]);
    expect(animate.mock.contexts[0]).toBeInstanceOf(HTMLElement);
    expect((animate.mock.contexts[0] as HTMLElement).tagName).toBe("MAIN");
  });

  it("morphs the top-right control: fades out, eases the slot width, fades in, aria intact", () => {
    vi.useFakeTimers();
    const view = <div role="group" aria-label="View" />;
    const { rerender } = render(frame({ device: "desktop" } as never));
    expect(screen.getByRole("group", { name: "Device" })).toBeTruthy();
    animate.mockClear();
    rerender(<Frame back={null} level={1} rail={<p>rail</p>} onDevice={() => {}} controls={view} dark={false} onToggleTheme={() => {}}><p>main</p></Frame>);
    expect(durations()).toEqual([120]);
    expect(screen.getByRole("group", { name: "Device" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(120));
    expect(screen.queryByRole("group", { name: "Device" })).toBeNull();
    expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
    expect(durations()).toEqual([120, 240, 180]);
    vi.useRealTimers();
  });

  // The shell keeps one Frame across browse and edit mode.
  const modes = (edit: boolean, toolbar?: ReactNode) => (
    <div>
      <Frame
        back={null}
        level={edit ? 2 : 1}
        rail={<p>rail</p>}
        onDevice={() => {}}
        actions={<button type="button" aria-pressed={edit}>Edit</button>}
        toolbar={edit ? toolbar : undefined}
        dark={false}
        onToggleTheme={() => {}}
      >
        <p>main</p>
      </Frame>
    </div>
  );
  const editActions = (label = "Publish") => (
    <>
      <button type="button">Save</button>
      <button type="button">{label}</button>
    </>
  );

  it("keeps Edit in place and unfolds the edit toolbar row under the top bar, then folds it away", () => {
    // The level change also slides the rail (560ms); only the row is under test here.
    const row = () => durations().filter((d) => d !== 560);
    const { rerender } = render(modes(false));
    expect(screen.queryByRole("group", { name: "Edit" })).toBeNull();
    animate.mockClear();
    rerender(modes(true, editActions()));
    expect(row()).toEqual([200]);
    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")).toBe("true");
    const toolbar = screen.getByRole("group", { name: "Edit" });
    expect(toolbar.id).toBe("typren-edit-row");
    expect(within(toolbar).getByRole("button", { name: "Save" })).toBeTruthy();

    animate.mockClear();
    rerender(modes(false));
    expect(row()).toEqual([200]);
    expect(screen.queryByRole("group", { name: "Edit" })).toBeNull();
  });

  // jsdom lays nothing out: fakes a top bar `area` wide, Edit 64px, the
  // toolbar 150px and the right-hand controls 100px.
  const layout = (area: number) => {
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (this.id === "typren-edit-row" || this.className.includes("w-fit")) return 150;
      // The morph container: Edit alone, or Edit's pencil plus the toolbar.
      return this.className.includes("group/actions") ? (this.hasAttribute("data-morphed") ? 186 : 64) : 0;
    });
    const cell = document.querySelector("header > .\\@container")!;
    const [first, last] = [cell.previousElementSibling!, cell.nextElementSibling!];
    const box = (left: number, right: number) => ({ left, right, width: right - left }) as DOMRect;
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this === first) return box(0, 100);
      if (this === last) return box(area - 100, area);
      // Edit, then the toolbar's own box or the box holding both.
      if (this.parentElement === first)
        return this.id === "typren-edit-row" || this.querySelector("#typren-edit-row") ? box(0, 64 + 8 + 150) : box(0, 64);
      if (this.parentElement === last) return box(area - 100, area);
      return box(0, 0);
    });
    return () => {
      width.mockRestore();
      rect.mockRestore();
    };
  };

  it("seats the edit toolbar in the top bar while the pill keeps its width centred", () => {
    const { rerender } = render(modes(false));
    let restore = layout(800);
    rerender(modes(true, editActions()));
    const group = screen.getByRole("group", { name: "Edit" });
    expect(group.closest("header")).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Save" })).toBeTruthy();
    // Both side cells reserve the wider side's width, Edit plus the toolbar.
    expect(document.querySelector("header")!.style.getPropertyValue("--side")).toBe("222px");
    restore();
    // Too narrow for both: back to the row under the bar.
    rerender(modes(false));
    restore = layout(600);
    rerender(modes(true, editActions()));
    expect(screen.getByRole("group", { name: "Edit" }).closest("main")).toBeTruthy();
    expect(document.querySelector("header")!.style.getPropertyValue("--side")).toBe("100px");
    restore();
  });

  it("morphs Edit into the edit toolbar where the bar has room, moving focus in and back out", () => {
    const { rerender } = render(modes(false));
    const restore = layout(800);
    const morph = () => document.querySelector<HTMLElement>(".group\\/actions")!;
    const box = morph();
    const edit = screen.getByRole("button", { name: "Edit" });
    edit.focus();
    rerender(modes(false));
    animate.mockClear();
    rerender(modes(true, editActions()));
    expect(morph()).toBe(box);
    expect(box.hasAttribute("data-morphed")).toBe(true);
    expect(screen.getByRole("button", { name: "Edit" })).toBe(edit);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
    const grow = animate.mock.calls.find((_, i) => animate.mock.contexts[i] === box)!;
    expect(grow[0]).toEqual([{ width: "64px" }, { width: "186px" }]);
    expect(grow[1]).toMatchObject({ duration: 200 });

    animate.mockClear();
    rerender(modes(false));
    expect(box.hasAttribute("data-morphed")).toBe(false);
    expect(document.activeElement).toBe(edit);
    expect(animate.mock.contexts).toContain(box);
    restore();
  });

  it("updates the edit toolbar in place, without motion", () => {
    const { rerender } = render(modes(true, editActions()));
    animate.mockClear();
    rerender(modes(true, editActions("Push")));
    expect(screen.getByRole("button", { name: "Push" })).toBeTruthy();
    expect(animate).not.toHaveBeenCalled();
  });

  it("opens the edit toolbar instantly under reduced motion", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") })) as never;
    const { rerender } = render(modes(false));
    rerender(modes(true, editActions()));
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(animate).not.toHaveBeenCalled();
    window.matchMedia = matchMedia;
  });

  const pill = (title: string, url: string, status: string) => ({ title, url, status });
  const search = { hits: [], onPick: vi.fn() };

  it("morphs only the changed pill pieces on a page change", () => {
    vi.useFakeTimers();
    const { rerender } = render(frame({ search, pill: pill("Home", "/", "Published") }));
    animate.mockClear();
    rerender(frame({ search, pill: pill("About", "/about", "Published") }));
    expect(durations()).toEqual([180, 180, 120, 120]);
    const ghosts = document.querySelectorAll("span[aria-hidden='true'].whitespace-nowrap");
    expect([...ghosts].map((g) => g.textContent)).toEqual(["Home", "/"]);
    act(() => void vi.advanceTimersByTime(120));
    expect(document.querySelectorAll("span[aria-hidden='true'].whitespace-nowrap").length).toBe(0);
    vi.useRealTimers();
  });

  it("morphs just the status in place, leaving the title alone", () => {
    vi.useFakeTimers();
    const { rerender } = render(frame({ search, pill: pill("Home", "/", "Published") }));
    animate.mockClear();
    rerender(frame({ search, pill: pill("Home", "/", "Unsaved changes") }));
    expect(durations()).toEqual([180, 120]);
    expect(animate.mock.contexts[0]).toHaveProperty("textContent", "Unsaved changes");
    act(() => void vi.advanceTimersByTime(120));
    vi.useRealTimers();
  });

  it("fades only the changed text in when the pill remounts on a page switch", () => {
    const first = render(frame({ search, pill: pill("Remount A", "/a", "Published") }));
    first.unmount();
    animate.mockClear();
    render(frame({ search, pill: pill("Remount B", "/b", "Published") }));
    expect(durations()).toEqual([180, 180]);
    expect(document.querySelectorAll("span[aria-hidden='true'].whitespace-nowrap").length).toBe(0);
  });

  it("morphs the resting text into the placeholder on focus and back on blur", async () => {
    const user = userEvent.setup();
    render(frame({ search, pill: pill("Home", "/", "Published") }));
    const box = screen.getByRole("combobox", { name: /^Search/ });
    const resting = screen.getByText("Home").closest("div")!;
    expect(resting.getAttribute("aria-hidden")).toBeNull();
    expect(resting.className).not.toContain("opacity-0");
    await user.click(box);
    expect(resting.getAttribute("aria-hidden")).toBe("true");
    expect(resting.className).toContain("opacity-0");
    expect(box.className).not.toContain("placeholder:opacity-0");
    await user.tab();
    expect(resting.getAttribute("aria-hidden")).toBeNull();
    expect(box.className).toContain("placeholder:opacity-0");
  });

  it("stays still when the user prefers reduced motion", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") })) as never;
    const { rerender } = render(frame({ level: 0, screen: "preview" }));
    rerender(frame({ level: 1, screen: "settings" }));
    rerender(<Frame back={null} level={1} rail={<p>rail</p>} onDevice={() => {}} controls={<div role="group" aria-label="View" />} dark={false} onToggleTheme={() => {}}><p>main</p></Frame>);
    expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
    expect(animate).not.toHaveBeenCalled();
    window.matchMedia = matchMedia;
  });

  it("swaps pill text instantly under reduced motion", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") })) as never;
    const { rerender } = render(frame({ search, pill: pill("Home", "/", "Published") }));
    rerender(frame({ search, pill: pill("About", "/about", "Unpublished changes") }));
    expect(screen.getByText("About")).toBeTruthy();
    expect(document.querySelectorAll("span[aria-hidden='true'].whitespace-nowrap").length).toBe(0);
    expect(animate).not.toHaveBeenCalled();
    window.matchMedia = matchMedia;
  });
});

describe("Frame live region", () => {
  it("announces the pill status through one polite region", () => {
    const pill = (status: string) => ({ title: "Home", url: "/", status });
    const { rerender } = render(frame({ pill: pill("Published") }));
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("Published");
    rerender(frame({ pill: pill("Draft saved") }));
    expect(live.textContent).toBe("Draft saved");
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});

describe("Frame rail drawer", () => {
  it("opens the rail from the menu button and closes it on Escape", async () => {
    const user = userEvent.setup();
    render(frame());
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Close menu" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Studio" });
    expect(nav.className).toContain("invisible");
    await user.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(nav.className).not.toContain("invisible");
    // The open drawer leads with the lockup.
    expect(within(nav).getByText("Typren")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Studio" }).className).toContain("fixed");
    await user.keyboard("{Escape}");
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu);
  });
});

describe("Frame title", () => {
  it("names the screen with one h1 and the document title, restoring it on unmount", () => {
    document.title = "Host";
    const { unmount } = render(
      <Frame title="Assets" back={null} level={1} rail={<p>rail</p>} device="desktop" onDevice={() => {}} dark={false} onToggleTheme={() => {}}>
        <p>main</p>
      </Frame>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Assets" })).toBeTruthy();
    expect(document.title).toBe("Assets · Typren Studio");
    unmount();
    expect(document.title).toBe("Host");
  });
});

describe("Frame search names", () => {
  it("clears the query from its clear button, keeping focus in the field", async () => {
    const user = userEvent.setup();
    render(frame({ search: { hits, onPick: () => {} } }));
    const box = screen.getByRole("combobox", { name: /^Search/ });
    await user.type(box, "terms");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect((box as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("includes the current page in the combobox name and counts results", async () => {
    const user = userEvent.setup();
    render(frame({ pill: { title: "Home", url: "/", status: "Published" }, search: { hits, onPick: vi.fn() } }));
    const box = screen.getByRole("combobox", { name: "Search (current page: Home)" });
    await user.type(box, "abo");
    expect(screen.getByRole("status").textContent).toBe("2 results");
  });
});

describe("Frame skip link", () => {
  it("moves focus to main", async () => {
    render(frame());
    await userEvent.setup().click(screen.getByRole("link", { name: "Skip to content" }));
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});

describe("Frame root", () => {
  it("clips its own overflow, so a screen's fade-in transform never makes the page scroll", () => {
    const { container } = render(frame());
    expect(container.firstElementChild!.className).toContain("overflow-clip");
  });
});

describe("Frame rail collapse", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  const rail = () => screen.getByRole("navigation", { name: "Studio" });

  it("starts expanded, collapses on demand and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(frame());
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(collapse.getAttribute("aria-controls")).toBe(rail().id);
    expect(rail().hasAttribute("inert")).toBe(false);

    await user.click(collapse);
    expect(localStorage.getItem("typren-rail")).toBe("collapsed");
    expect(rail().hasAttribute("inert")).toBe(true);
    // Only in the top bar: the peek panel shows the rail alone.
    expect(screen.getAllByRole("button", { name: "Expand sidebar" })).toHaveLength(1);
    expect(within(rail()).queryByText("Typren")).toBeNull();

    unmount();
    render(frame());
    expect(rail().hasAttribute("inert")).toBe(true);
    await user.click(screen.getAllByRole("button", { name: "Expand sidebar" })[0]);
    expect(localStorage.getItem("typren-rail")).toBe("expanded");
    expect(rail().hasAttribute("inert")).toBe(false);
  });

  it("peeks from the expand button, stays open while pointer or focus is inside, and closes on leave or Escape", () => {
    vi.useFakeTimers();
    localStorage.setItem("typren-rail", "collapsed");
    render(frame({ rail: <button>Pages</button> } as never));
    const [expand] = screen.getAllByRole("button", { name: "Expand sidebar" });

    fireEvent.pointerEnter(expand.parentElement!);
    expect(rail().hasAttribute("inert")).toBe(false);
    fireEvent.pointerLeave(expand.parentElement!);
    fireEvent.pointerEnter(rail());
    act(() => void vi.advanceTimersByTime(200));
    expect(rail().hasAttribute("inert")).toBe(false);

    screen.getByRole("button", { name: "Pages" }).focus();
    fireEvent.pointerLeave(rail());
    act(() => void vi.advanceTimersByTime(200));
    expect(rail().hasAttribute("inert")).toBe(false);

    fireEvent.keyDown(rail(), { key: "Escape" });
    expect(rail().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(expand);

    expect(rail().hasAttribute("inert")).toBe(true);
    expand.blur();
    act(() => void vi.advanceTimersByTime(200));
    act(() => expand.focus());
    expect(rail().hasAttribute("inert")).toBe(false);
    act(() => expand.blur());
    act(() => void vi.advanceTimersByTime(200));
    expect(rail().hasAttribute("inert")).toBe(true);
    fireEvent.pointerEnter(expand.parentElement!);
    expect(rail().hasAttribute("inert")).toBe(false);
    fireEvent.pointerLeave(rail());
    act(() => void vi.advanceTimersByTime(200));
    expect(rail().hasAttribute("inert")).toBe(true);
  });

  it("holds the expand button's tooltip back while the peek is open, so it can't cover the panel", () => {
    localStorage.setItem("typren-rail", "collapsed");
    render(frame());
    const [expand] = screen.getAllByRole("button", { name: "Expand sidebar" });
    expect(expand.hasAttribute("data-trigger-disabled")).toBe(false);
    fireEvent.pointerEnter(expand.parentElement!);
    expect(expand.hasAttribute("data-trigger-disabled")).toBe(true);
  });

  it("insets the top bar exactly as the preview card, so their edges line up", () => {
    // jsdom lays nothing out, so this pins the shared inset the live layout relies on.
    const frame = () => (
      <Frame back={null} level={1} rail={<p>rail</p>} onDevice={() => {}} dark={false} onToggleTheme={() => {}}>
        <p>main</p>
      </Frame>
    );
    const inset = (el: Element) => el.className.split(" ").filter((c) => /^(md:)?p[lrx]-/.test(c)).sort();
    const { unmount } = render(frame());
    const header = document.querySelector("header")!;
    const main = document.getElementById("typren-main")!;
    expect(inset(header)).toEqual(inset(main));
    // Pinned, the rail's column gives back the bar's gap, so the first control starts where the card does.
    expect(header.className).toContain("md:gap-3");
    expect(header.className).toContain("md:grid-cols-[calc(18rem-0.75rem)_");
    unmount();
    localStorage.setItem("typren-rail", "collapsed");
    render(frame());
    expect(inset(document.querySelector("header")!)).toEqual(inset(document.getElementById("typren-main")!));
    localStorage.removeItem("typren-rail");
  });

  it("keeps Back in the peek panel when drilled in", () => {
    localStorage.setItem("typren-rail", "collapsed");
    render(<Frame back={{ label: "Website", onBack: () => {} }} level={1} rail={<p>rail</p>} onDevice={() => {}} dark={false} onToggleTheme={() => {}}><p>main</p></Frame>);
    expect(within(rail()).getByRole("button", { name: "Website" })).toBeTruthy();
  });

  it("does not peek straight back open after collapsing, until the pointer or focus leaves the trigger", () => {
    vi.useFakeTimers();
    render(frame());
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    // Focus moves to the expand button, and the pointer resting on it does not peek.
    expect(document.activeElement).toBe(expand);
    fireEvent.pointerEnter(expand.parentElement!);
    expect(rail().hasAttribute("inert")).toBe(true);
    fireEvent.pointerLeave(expand.parentElement!);
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.pointerEnter(expand.parentElement!);
    expect(rail().hasAttribute("inert")).toBe(false);
  });

  it("starts collapsed at tablet width without overwriting the stored choice", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("63.99rem"), addEventListener() {}, removeEventListener() {} })) as never;
    try {
      const user = userEvent.setup();
      render(frame());
      expect(rail().hasAttribute("inert")).toBe(true);
      await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
      expect(rail().hasAttribute("inert")).toBe(false);
      expect(localStorage.getItem("typren-rail")).toBeNull();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("glides the content from where it was when the rail collapses", () => {
    const animate = vi.fn();
    Element.prototype.animate = animate as never;
    let x = 0;
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ left: (x += 10) }) as DOMRect);
    render(frame());
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    const moved = animate.mock.contexts as Element[];
    expect(moved.some((el) => el.tagName === "MAIN")).toBe(true);
    // The rail slides out on its own transition, so it is not glided.
    expect(moved).not.toContain(rail());
    animate.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand sidebar" })[0]);
    // Pinning glides the rail in and fades the lockup back.
    expect(animate.mock.contexts).toContain(rail());
    expect(animate.mock.calls.some(([frames]) => (frames as Keyframe[])[0].opacity === 0)).toBe(true);
    box.mockRestore();
  });
});

describe("Frame narrow-viewport search sheet", () => {
  it("opens the same search as a sheet, picks with Enter, and returns focus on Escape", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onPick = vi.fn();
    render(frame({ search: { hits, onOpen, onPick } }));
    const button = screen.getByRole("button", { name: "Search" });
    await user.click(button);
    const sheet = await screen.findByRole("dialog", { name: "Search" });
    const input = within(sheet).getByRole("combobox", { name: "Search" });
    expect(document.activeElement).toBe(input);
    expect(onOpen).toHaveBeenCalled();
    await user.type(input, "ter");
    expect(within(sheet).getAllByRole("option").map((o) => o.textContent)).toEqual(["Terms"]);
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "page:terms" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(button);
    await screen.findByRole("dialog", { name: "Search" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });
});

describe("Frame theme", () => {
  it("mirrors dark onto <html> and keeps it after unmount", () => {
    const html = document.documentElement;
    const { rerender, unmount } = render(frame());
    expect(html.classList.contains("dark")).toBe(false);
    rerender(<Frame back={null} level={1} rail={<p>rail</p>} device="desktop" onDevice={() => {}} dark onToggleTheme={() => {}}><p>main</p></Frame>);
    expect(html.classList.contains("dark")).toBe(true);
    unmount();
    expect(html.classList.contains("dark")).toBe(true);
    html.classList.remove("dark");
  });

  it("leaves a host's pre-paint dark class alone on the first light pass", () => {
    const html = document.documentElement;
    html.classList.add("dark");
    const { rerender } = render(frame());
    expect(html.classList.contains("dark")).toBe(true);
    rerender(<Frame back={null} level={1} rail={<p>rail</p>} device="desktop" onDevice={() => {}} dark onToggleTheme={() => {}}><p>main</p></Frame>);
    rerender(frame());
    expect(html.classList.contains("dark")).toBe(false);
  });
});
