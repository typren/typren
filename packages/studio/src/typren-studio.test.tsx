import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageFlows, PageContent, PageInfo, SiteSettings } from "@typren/core";
import { matchHits } from "./frame";
import { TyprenStudio, pageText, previewSrc, slugAtPath, type TyprenStudioHost, type TyprenStudioProps } from "./typren-studio";

afterEach(cleanup);

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const actions = {
  createPage: vi.fn(async (title: string) => title),
  createPageFrom: vi.fn(async (title: string) => title),
  updatePageMeta: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  deletePage: vi.fn(async () => {}),
  saveDraft: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  publish: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  discardDraft: vi.fn(async () => {}),
} as unknown as PageActions & PageFlows;

const host: TyprenStudioHost = { actions, sliceNames: [], defaults: {}, previewPath: "/preview" };
const pages: PageInfo[] = [
  { slug: "home", title: "Home", hasDraft: false, locales: ["en"], nav: true, navOrder: 1 },
  { slug: "terms", title: "Terms", hasDraft: true, locales: ["en"] },
  { slug: "404", title: "Not found", hasDraft: false, locales: ["en"], system: true },
];
const page: PageContent = { meta: {}, slices: [{ slice: "hero" }], body: "" };

const iconOf = (text: HTMLElement) => text.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
const mount = (props: Partial<TyprenStudioProps> = {}) =>
  render(<TyprenStudio host={host} pages={pages} onNavigate={() => {}} onReload={() => {}} {...props} />);

describe("universal search", () => {
  it("pageText collects every string and drops markdown emphasis", () => {
    const c = { meta: {}, body: "Body", slices: [{ slice: "hero", heading: "Go **fast**", items: [{ t: "deep" }] }] };
    expect(pageText(c as unknown as PageContent)).toBe("hero Go fast deep Body");
  });

  it("matchHits snippets a text-only match and caps results", () => {
    const hits = [
      { id: "a", group: "Pages", label: "About", text: "we move money across borders quickly" },
      { id: "b", group: "Pages", label: "Borders" },
    ];
    expect(matchHits(hits, "borders").map((h) => h.id)).toEqual(["a", "b"]);
    expect(matchHits(hits, "borders")[0].hint).toContain("money across borders quickly");
    expect(matchHits(hits, "", 1)).toHaveLength(1);
  });

  it("finds page content, assets and settings and opens their entries", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onNavigateSection = vi.fn();
    mount({
      host: {
        ...host,
        sections: [
          { kind: "pages", label: "Pages" },
          { kind: "media", label: "Assets", id: "assets" },
          { kind: "settings", label: "Settings" },
        ],
        media: { list: async () => [{ id: "m1", name: "logo.svg" }], delete: async () => {} } as never,
        readPage: async (slug) => ({ meta: {}, body: "", slices: slug === "terms" ? [{ slice: "x", copy: "refund window" }] : [] }) as never,
      },
      sectionId: "assets",
      onNavigate,
      onNavigateSection,
    });
    const box = screen.getByRole("combobox", { name: /^Search/ });
    await user.type(box, "refund");
    await user.keyboard("{Enter}");
    expect(onNavigateSection).toHaveBeenCalledWith("pages");
    expect(onNavigate).toHaveBeenCalledWith("terms");

    await user.type(box, "logo.svg");
    await user.click(within(await screen.findByRole("listbox", { name: "Search results" })).getByRole("option", { name: "logo.svg" }));
    expect(onNavigateSection).toHaveBeenLastCalledWith("assets");

    await user.type(box, "SEO description");
    await user.keyboard("{Enter}");
    expect(onNavigateSection).toHaveBeenLastCalledWith("settings");
  });
});

describe("previewSrc", () => {
  it("falls back to previewPath/slug", () => {
    expect(previewSrc(host, "about", 3)).toBe("/preview/about?v=3");
  });

  it("uses an absolute cross-origin previewUrl as-is, keeping its own query", () => {
    const h = { ...host, previewUrl: (s: string) => `http://127.0.0.1:3000/${s}/?draft=1` };
    expect(previewSrc(h, "about", 0, "es")).toBe("http://127.0.0.1:3000/about/?draft=1&v=0&locale=es");
  });
});

describe("TyprenStudio rail", () => {
  it("opens at the site level, drills into Pages and reports going back", async () => {
    const onNavigateSection = vi.fn();
    const user = userEvent.setup();
    mount({ onNavigateSection });
    expect(screen.getByText("Typren")).toBeTruthy();
    expect(screen.queryByText("Not in navigation")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Pages" }));
    expect(onNavigateSection).toHaveBeenCalledWith("pages");
    for (const g of ["Not in navigation", "System Pages"]) expect(screen.getByText(g)).toBeTruthy();
    expect(screen.getByLabelText("Home page")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Website" }));
    expect(onNavigateSection).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText("Not in navigation")).toBeNull();
  });

  it("switches the preview locale among the site's locales, and remembers the pick", async () => {
    const user = userEvent.setup();
    const bootstrap = (locales: string[]) =>
      ({ brand: { name: "Site" }, seo: {}, bootstrap: { locales, defaultLocale: "en" } }) as unknown as TyprenStudioProps["settingsSnapshot"];
    const onLocaleChange = vi.fn();
    // One locale: nothing to switch.
    const single = mount({ slug: "home", settingsSnapshot: bootstrap(["en"]), onLocaleChange });
    expect(screen.queryByRole("combobox", { name: "Preview locale" })).toBeNull();
    single.unmount();
    const props = { host, pages, onNavigate: () => {}, onReload: () => {}, slug: "home", onLocaleChange };
    const view = mount({ slug: "home", settingsSnapshot: bootstrap(["en", "fr"]), onLocaleChange });
    expect(onLocaleChange).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("combobox", { name: "Preview locale" })[0]!);
    await user.click(await screen.findByRole("option", { name: "fr" }));
    expect(onLocaleChange).toHaveBeenLastCalledWith("fr");
    expect(localStorage.getItem("typren-locale")).toBe("fr");
    view.rerender(<TyprenStudio {...props} settingsSnapshot={bootstrap(["en", "fr"])} locale="fr" />);
    expect(view.container.querySelector("iframe")?.getAttribute("src")).toContain("locale=fr");
    view.unmount();
    // A later visit restores it; the host is told once.
    onLocaleChange.mockClear();
    mount({ slug: "home", settingsSnapshot: bootstrap(["en", "fr"]), onLocaleChange });
    expect(onLocaleChange).toHaveBeenCalledExactlyOnceWith("fr");
    localStorage.removeItem("typren-locale");
  });

  it("opens on Pages when the host names it", () => {
    mount({ sectionId: "pages" });
    expect(screen.getByText("Not in navigation")).toBeTruthy();
  });

  it("shows the site name at level 0 and opens sections from it", async () => {
    const onNavigateSection = vi.fn();
    const user = userEvent.setup();
    mount({
      host: { ...host, sections: [{ kind: "pages", label: "Pages" }, { kind: "media", label: "Media" }] },
      onNavigateSection,
      settingsSnapshot: { brand: { name: "My Site" }, seo: {} } as TyprenStudioProps["settingsSnapshot"],
    });
    expect(screen.getByText("My Site")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pages" }));
    expect(onNavigateSection).toHaveBeenCalledWith("pages");
  });

  it("drills Assets into its own level, with the library in the main area", () => {
    mount({ host: { ...host, sections: [{ kind: "pages", label: "Pages" }, { kind: "media", label: "Media" }] }, sectionId: "media" });
    expect(screen.getByText("Assets", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /All Assets/ })).toBeTruthy();
    expect(iconOf(screen.getByText(/Media library isn.t configured/))).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Device" })).toBeNull();
  });

  it("a custom entry renders a notice rather than an empty pane", () => {
    mount({ host: { ...host, sections: [{ kind: "custom", label: "Analytics", element: "x-analytics" }] } });
    expect(iconOf(screen.getByText(/isn.t available in the studio yet/))).toBeTruthy();
  });

  it("asks for a page when none is open", () => {
    mount();
    expect(iconOf(screen.getByText("Select a page to edit, or add a new one."))).toBeTruthy();
  });

  it("opens the Style screen for the style entry", () => {
    mount({
      host: { ...host, sections: [{ kind: "custom", id: "style", label: "Style", host: true }] },
      sectionId: "style",
    });
    expect(iconOf(screen.getByText(/Style isn.t configured/))).toBeTruthy();
  });

  it("drills Style into Colors, Type and Shape", async () => {
    const user = userEvent.setup();
    const onNavigateSection = vi.fn();
    const settings = { saveDraft: vi.fn(), publish: vi.fn(), writeBootstrap: vi.fn() };
    mount({
      host: { ...host, settings, sections: [{ kind: "pages", label: "Pages" }, { kind: "custom", id: "style", label: "Style", host: true }] },
      settingsSnapshot: { brand: { name: "Acme" }, seo: {}, style: { "--typren-primary": "#112233" } } as never,
      onNavigateSection,
    });
    await user.click(screen.getByRole("button", { name: "Style" }));
    expect(screen.getByRole("button", { name: "Colors" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("listbox", { name: "Brand" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Type" }));
    expect(screen.getByRole("option", { name: "Headings" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Shape" }));
    expect(screen.getByRole("option", { name: "Corner radius" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Website" }));
    expect(onNavigateSection).toHaveBeenLastCalledWith(null);
  });

  it("reports page clicks through onNavigate", async () => {
    const onNavigate = vi.fn();
    mount({ onNavigate, sectionId: "pages" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Terms" }));
    expect(onNavigate).toHaveBeenCalledWith("terms");
  });

  it("creates and deletes pages from the Pages level", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    mount({ onNavigate, sectionId: "pages" });
    await user.click(screen.getByRole("button", { name: "New page" }));
    await user.type(screen.getByLabelText("Title"), "Pricing{Enter}");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Slug")).toHaveProperty("value", "pricing");
    await user.keyboard("{Enter}{Enter}{Enter}");
    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith("Pricing", { edit: true }));
    expect(actions.createPageFrom).toHaveBeenCalledWith("Pricing", "pricing", [], undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Settings for Terms" }));
    await user.click(await screen.findByRole("button", { name: "Delete page" }));
    await answer("Delete");
    await vi.waitFor(() => expect(actions.deletePage).toHaveBeenCalledWith("terms"));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it("saves page settings as a draft and renames through the host, reloading after each", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const onNavigate = vi.fn();
    const renamePage = vi.fn(async (_s: string, to: string) => ({ ok: true as const, slug: to }));
    const getPage = vi.fn(async () => ({ page: { meta: { title: "Terms" }, slices: [], body: "" }, version: "v0" }));
    mount({ host: { ...host, getPage, renamePage }, onReload, onNavigate, sectionId: "pages", slug: "terms" });
    await user.click(screen.getByRole("button", { name: "Settings for Terms" }));
    await user.click(await screen.findByLabelText("Hide from search engines"));
    await user.clear(screen.getByLabelText("Slug"));
    await user.type(screen.getByLabelText("Slug"), "legal");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(renamePage).toHaveBeenCalledWith("terms", "legal"));
    expect(actions.updatePageMeta).toHaveBeenCalledWith("terms", { title: "Terms", noindex: true, description: "" }, "v0");
    expect(onReload).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenCalledWith("legal");
  });
});

describe("TyprenStudio browse and edit", () => {
  it("browse mode previews the page with its pill, and Edit needs the page content", () => {
    const { container } = mount({ slug: "terms" });
    expect(container.querySelector("iframe")!.getAttribute("src")).toBe("/preview/terms?v=0");
    expect(screen.getByRole("combobox", { name: /^Search/ }).parentElement!.textContent).toContain("Unpublished changes");
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Edit enabled while the next page loads, so it does not flicker", () => {
    const el = <TyprenStudio host={host} pages={pages} slug="terms" onNavigate={() => {}} onReload={() => {}} />;
    const { rerender } = render({ ...el, props: { ...el.props, page, version: "v1" } });
    const edit = () => screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement;
    expect(edit().disabled).toBe(false);
    rerender({ ...el, props: { ...el.props, slug: "about", page: undefined, version: null } });
    expect(edit().disabled).toBe(false);
  });

  it("keeps and deletes page folders through the host, then reloads", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const pageFolders = { create: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
    mount({ host: { ...host, pageFolders }, folders: ["kept"], sectionId: "pages", onReload });
    await user.click(screen.getByRole("button", { name: "Delete folder kept" }));
    await answer("Delete");
    await vi.waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(pageFolders.delete).toHaveBeenCalledWith("kept");
    await user.click(screen.getByRole("button", { name: "New page" }));
    await user.click(screen.getByRole("button", { name: /Only a folder/ }));
    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Slug"), "more{Enter}{Enter}");
    await vi.waitFor(() => expect(onReload).toHaveBeenCalledTimes(2));
    expect(pageFolders.create).toHaveBeenCalledWith("more");
  });

  it("labels a draft-only page Draft in the pill", () => {
    mount({ slug: "idea", pages: [...pages, { slug: "idea", title: "Idea", hasDraft: true, locales: [], published: false }] });
    expect(screen.getByRole("combobox", { name: /^Search/ }).parentElement!.textContent).toContain("Draft");
  });

  it("Edit toggles level 2 and its toolbar row, and back to browse", async () => {
    const user = userEvent.setup();
    mount({ slug: "home", page, version: "v1" });
    expect(screen.getByRole("combobox", { name: /^Search/ }).parentElement!.textContent).toContain("/");
    const edit = () => screen.getByRole("button", { name: "Edit" });
    expect(edit().getAttribute("aria-pressed")).toBe("false");
    await user.click(edit());
    const row = await screen.findByRole("group", { name: "Edit" });
    expect(within(row).getAllByText("Up to date")[0]).toBeTruthy();
    expect(edit().getAttribute("aria-pressed")).toBe("true");
    expect(edit().getAttribute("aria-controls")).toBe(row.id);
    await user.click(edit());
    await waitFor(() => expect(screen.queryByRole("group", { name: "Edit" })).toBeNull());
    expect(edit().getAttribute("aria-pressed")).toBe("false");
    await user.click(edit());
    await screen.findByRole("group", { name: "Edit" });
    await user.click(screen.getByRole("button", { name: "Pages" }));
    await waitFor(() => expect(edit().getAttribute("aria-pressed")).toBe("false"));
  });

  it("follows a host-controlled editing prop and reports Edit clicks", async () => {
    const onEditingChange = vi.fn();
    const { rerender } = mount({ slug: "home", page, version: "v1", editing: false, onEditingChange });
    await userEvent.setup().click(screen.getByRole("button", { name: "Edit" }));
    expect(onEditingChange).toHaveBeenCalledWith(true);
    const at = (editing: boolean) => (
      <TyprenStudio host={host} pages={pages} onNavigate={() => {}} onReload={() => {}} slug="home" page={page} version="v1" editing={editing} />
    );
    rerender(at(true));
    expect(await screen.findByRole("group", { name: "Edit" })).toBeTruthy();
    // The host navigating back (browser Back on `?edit`) leaves edit mode.
    rerender(at(false));
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("the pill searches pages and opens the first match on Enter", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    mount({ slug: "home", onNavigate });
    await user.type(screen.getByRole("combobox", { name: /^Search/ }), "ter");
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("terms");
  });

  it("switches the preview width with the global device toggle", async () => {
    const { container } = mount({ slug: "home" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Mobile" }));
    expect((container.querySelector("iframe")!.parentElement!.parentElement as HTMLElement).style.width).toBe("390px");
  });

  it("picks the studio theme from the rail's light/dark selector", async () => {
    const user = userEvent.setup();
    const { container } = mount();
    const root = () => (container.firstElementChild as HTMLElement).className;
    const theme = screen.getByRole("group", { name: "Studio theme" });
    await user.click(within(theme).getByRole("button", { name: "Dark" }));
    expect(root()).toContain("dark");
    await user.click(within(theme).getByRole("button", { name: "Dark" }));
    expect(root()).toContain("dark");
    await user.click(within(theme).getByRole("button", { name: "Light" }));
    expect(root()).not.toContain("dark");
  });
});

describe("following the preview", () => {
  const site = { ...host, previewUrl: (s: string) => (s === "home" ? "http://site.test/" : `http://site.test/${s}/`) };
  const live = (props: Partial<TyprenStudioProps> = {}) =>
    mount({ host: site, sectionId: "pages", slug: "home", page, ...props });
  const frame = () => document.querySelector("iframe")!;
  const say = (data: unknown, source: MessageEventSource | null = frame().contentWindow, origin = "http://site.test") =>
    act(() => void window.dispatchEvent(new MessageEvent("message", { data, source, origin })));

  it("maps a frame path back to a listed page, slash or not", () => {
    expect(slugAtPath(site, pages, "/")).toBe("home");
    expect(slugAtPath(site, pages, "/terms")).toBe("terms");
    expect(slugAtPath(site, pages, "/terms/")).toBe("terms");
    expect(slugAtPath(site, pages, "/nope/")).toBeNull();
    expect(slugAtPath(host, pages, "/preview/terms")).toBe("terms");
  });

  it("moves the pill and URL with the frame's own navigation, without reloading it", () => {
    const onNavigate = vi.fn();
    const { rerender } = live({ onNavigate });
    const shown = frame();
    const reply = vi.spyOn(shown.contentWindow!, "postMessage");
    shown.closest("header, div")!.setAttribute("data-marker", "kept");

    say({ __typren: true, type: "location", path: "/terms/" }, shown.contentWindow, "http://evil.test");
    expect(reply).not.toHaveBeenCalled();
    say({ __typren: true, type: "location", path: "/" });
    expect(reply).toHaveBeenCalledWith({ __typren: true, type: "browse" }, "http://site.test");
    expect(onNavigate).not.toHaveBeenCalled();

    say({ __typren: true, type: "location", path: "/terms/" });
    expect(onNavigate).toHaveBeenCalledWith("terms", { replace: true });
    rerender(<TyprenStudio host={site} pages={pages} sectionId="pages" slug="terms" onNavigate={onNavigate} onReload={() => {}} />);
    expect(frame()).toBe(shown);
    expect(frame().getAttribute("src")).toBe("http://site.test/?v=0");
    expect(screen.getByRole("combobox", { name: /^Search/ }).parentElement!.textContent).toContain("Terms");
    expect(document.querySelector("[data-marker='kept']")).toBeTruthy();

    // A page picked in the rail loads in a fresh frame.
    rerender(<TyprenStudio host={site} pages={pages} sectionId="pages" slug="home" onNavigate={onNavigate} onReload={() => {}} />);
    expect(frame().getAttribute("src")).toBe("http://site.test/?v=1");
    expect(frame()).not.toBe(shown);
  });

  // jsdom lays nothing out, so the edit toolbar takes the row under the bar
  // (the phone and narrow-bar layout) unless widths are faked.
  it.each([
    ["the row under the bar", "main", 0],
    ["the top bar", "header", 900],
  ])("keeps one preview frame and top bar across Edit on and off, toolbar in %s", async (_, where, wide) => {
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.id === "typren-edit-row" || this.className.includes("w-fit") ? 150 : 0;
    });
    const user = userEvent.setup();
    live();
    // A top bar `wide` across: its first cell's controls at its start, the last's at its end.
    const cell = document.querySelector("header > .\\@container")!;
    const [first, last] = [cell.previousElementSibling!, cell.nextElementSibling!];
    const box = (left: number, right: number) => ({ left, right, width: right - left }) as DOMRect;
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this === first || this.parentElement === first) return box(0, 64);
      if (this === last || this.parentElement === last) return box(wide - 100, wide);
      return box(0, 0);
    });
    const shown = frame();
    const src = shown.getAttribute("src");
    const reply = vi.spyOn(shown.contentWindow!, "postMessage");
    const bar = document.querySelector("header")!;
    const menu = screen.getByRole("button", { name: "Menu" });
    const editButton = screen.getByRole("button", { name: "Edit" });

    await user.click(editButton);
    expect(editButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Edit" }).closest(where)).toBeTruthy();
    expect(reply).toHaveBeenCalledWith({ __typren: true, type: "edit" }, "http://site.test");
    say({ __typren: true, type: "rects", rects: [] });
    // An edit canvas answers no `location` with browse.
    reply.mockClear();
    say({ __typren: true, type: "location", path: "/" });
    expect(reply).not.toHaveBeenCalled();
    for (const [el, now] of [[shown, frame()], [bar, document.querySelector("header")], [menu, screen.getByRole("button", { name: "Menu" })]])
      expect(now).toBe(el);
    expect(frame().getAttribute("src")).toBe(src);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")).toBe("false");
    expect(reply).toHaveBeenCalledWith({ __typren: true, type: "browse" }, "http://site.test");
    for (const [el, now] of [[shown, frame()], [bar, document.querySelector("header")], [menu, screen.getByRole("button", { name: "Menu" })]])
      expect(now).toBe(el);
    expect(frame().getAttribute("src")).toBe(src);
    width.mockRestore();
    rect.mockRestore();
  });

  it("reloads the frame into edit mode when its bridge does not answer `edit`", () => {
    vi.useFakeTimers();
    live();
    const shown = frame();
    act(() => screen.getByRole("button", { name: "Edit" }).click());
    expect(frame()).toBe(shown);
    act(() => void vi.advanceTimersByTime(500));
    expect(frame()).not.toBe(shown);
    expect(frame().getAttribute("src")).toBe("http://site.test/?v=1");
    vi.useRealTimers();
  });

  it("ignores other senders, malformed paths and pages it does not know", () => {
    const onNavigate = vi.fn();
    live({ onNavigate });
    say({ __typren: true, type: "location", path: "/terms/" }, window);
    say({ __typren: true, type: "location", path: "terms" });
    say({ __typren: true, type: "location", path: `/${"x".repeat(3000)}` });
    say({ __typren: true, type: "location", path: 42 });
    say({ __typren: true, type: "location", path: "/blog/post" });
    say({ type: "location", path: "/terms/" });
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("search while editing", () => {
  const site = { ...host, previewUrl: (s: string) => (s === "home" ? "http://site.test/" : `http://site.test/${s}/`) };
  const edited: PageContent = { meta: {}, slices: [{ slice: "hero", heading: "Hi" }], body: "" };
  const editing = (props: Partial<TyprenStudioProps> = {}) =>
    mount({ host: site, sectionId: "pages", slug: "home", page: edited, editing: true, onEditingChange: () => {}, ...props });
  const pick = async (text: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: /^Search/ }), text);
    await user.keyboard("{Enter}");
  };
  const dirty = () =>
    act(() => {
      const frame = document.querySelector("iframe")!;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __typren: true, type: "edit", index: 0, before: "Hi", after: "Hello" },
          source: frame.contentWindow,
          origin: "http://site.test",
        }),
      );
    });

  it("keeps edit mode on a page pick", async () => {
    const onNavigate = vi.fn();
    editing({ onNavigate });
    await pick("ter");
    expect(onNavigate).toHaveBeenCalledWith("terms", { edit: true });
  });

  it("saves unsaved edits before a pick", async () => {
    const onNavigate = vi.fn();
    vi.mocked(host.actions.saveDraft).mockClear();
    editing({ onNavigate });
    dirty();
    await pick("ter");
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("terms", { edit: true }));
    expect(host.actions.saveDraft).toHaveBeenCalledWith("home", expect.anything(), undefined, undefined);
  });

  it("asks before a pick drops edits that could not save, and Cancel stays", async () => {
    const onNavigate = vi.fn();
    // Every write fails here, the autosave's too, however the timers fall.
    vi.mocked(host.actions.saveDraft).mockRejectedValue(new Error("offline"));
    editing({ onNavigate });
    dirty();
    await pick("ter");
    await answer("Cancel");
    expect(onNavigate).not.toHaveBeenCalled();
    await pick("ter");
    await answer("Leave");
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("terms", { edit: true }));
    vi.mocked(host.actions.saveDraft).mockImplementation(async () => ({ ok: true as const, version: "v1" }));
  });

  it("leaves edit mode for a pick that is not a page", async () => {
    const onEditingChange = vi.fn();
    const onNavigateSection = vi.fn();
    editing({ onEditingChange, onNavigateSection, host: { ...site, sections: [{ kind: "pages", label: "Pages", group: "website" }, { kind: "settings", label: "Settings", group: "other" }] } });
    await pick("Settings");
    expect(onEditingChange).toHaveBeenCalledWith(false);
    expect(onNavigateSection).toHaveBeenCalledWith("settings");
  });
});

describe("settings and style in Review", () => {
  const snap: SiteSettings = {
    brand: { name: "Acme" },
    seo: {},
    bootstrap: { adminRoute: "studio", locales: ["en"], defaultLocale: "en", routing: "prefix-except-default", onboarded: true },
  };
  const setup = (hasDraft: boolean) => {
    const settings = {
      saveDraft: vi.fn(async () => ({ ok: true as const, version: "s2" })),
      publish: vi.fn(async () => ({ ok: true as const, version: "s3" })),
      discardDraft: vi.fn(async () => {}),
      hasDraft: vi.fn(async () => hasDraft),
    };
    const git = {
      outgoing: vi.fn(async () => ({ branch: "main", upstream: "origin/main", commits: [] })),
      pending: vi.fn(async () => []),
      push: vi.fn(async () => {}),
      discard: vi.fn(async () => {}),
    };
    const onReload = vi.fn();
    mount({
      host: { ...host, settings, git, sections: [{ kind: "pages", label: "Pages" }, { kind: "settings", label: "Settings" }] },
      sectionId: "settings",
      pages: pages.map((p) => ({ ...p, hasDraft: false })),
      settingsSnapshot: snap,
      settingsVersion: "s1",
      settingsHasDraft: hasDraft,
      onReload,
    });
    return { settings, git, onReload };
  };

  it("lists the settings draft, pushes it with the settings flag, and discards it through the settings actions", async () => {
    const user = userEvent.setup();
    const { settings, onReload } = setup(true);
    await user.click(await screen.findByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    expect(await within(dialog).findByText("Settings and Style")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Discard Site settings" }));
    await answer("Discard");
    await waitFor(() => expect(settings.discardDraft).toHaveBeenCalledWith(undefined));
    expect(onReload).toHaveBeenCalled();
    cleanup();
    const second = setup(true);
    await user.click(await screen.findByRole("button", { name: "Review" }));
    const again = await screen.findByRole("dialog", { name: "Review changes" });
    await within(again).findByText("Settings and Style");
    await user.click(within(again).getByRole("button", { name: "Push selected" }));
    await waitFor(() => expect(second.git.push).toHaveBeenCalledWith([], [], true));
  });

  it("keeps Review off with its reason until something is saved", async () => {
    setup(false);
    await waitFor(() => expect(screen.getByLabelText(/^Review: Nothing to review yet/)).toBeTruthy());
    expect((screen.getByRole("button", { name: "Review" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
