import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageContent, PageInfo } from "@typren/core";
import { PortalContext } from "./primitives/portal";
import { PageSettings, type PageSettingsIO } from "./page-settings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const info = (extra: Partial<PageInfo> = {}): PageInfo => ({ slug: "about", title: "About", hasDraft: false, locales: ["en"], ...extra });
const content = (meta: Record<string, unknown>): PageContent => ({ meta, slices: [{ slice: "Hero" }], body: "" });

function mount(props: Partial<Parameters<typeof PageSettings>[0]> = {}, meta: Record<string, unknown> = { title: "About" }) {
  const io = {
    load: vi.fn<PageSettingsIO["load"]>(async () => ({ page: content(meta), version: "v1" })),
    updateMeta: vi.fn<PageSettingsIO["updateMeta"]>(async () => ({ ok: true as const, version: "v2" })),
    rename: vi.fn(async (_s: string, to: string) => ({ ok: true as const, slug: to })),
  } satisfies PageSettingsIO;
  const fns = { onDelete: vi.fn(), onRenamed: vi.fn() };
  render(
    <PortalContext.Provider value={document.body}>
      <PageSettings
        page={info()}
        home={false}
        siblings={["about", "blog"]}
        nested={false}
        io={io}
        pending={false}
        triggerClassName=""
        {...fns}
        {...props}
      />
    </PortalContext.Provider>
  );
  return { io, ...fns };
}

const open = async (user: ReturnType<typeof userEvent.setup>, title = "About") => {
  await user.click(screen.getByRole("button", { name: `Settings for ${title}` }));
  await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(false));
};

describe("PageSettings", () => {
  it("opens from its trigger, and Escape closes it and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const { io } = mount();
    await open(user);
    expect(io.load).toHaveBeenCalledWith("about");
    // Title takes focus once the page has loaded.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
    expect(screen.getByText("Published")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("About");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings for About" }));
  });

  it("holds focus on the popup while the page loads, then moves it to Title", async () => {
    const user = userEvent.setup();
    const { io } = mount();
    let resolve!: (v: { page: PageContent; version: string }) => void;
    io.load.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await user.click(screen.getByRole("button", { name: "Settings for About" }));
    const popup = (await screen.findByRole("form")).closest("[data-slot=popover-content]");
    await waitFor(() => expect(document.activeElement).toBe(popup));
    resolve({ page: content({ title: "About" }), version: "v1" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
  });

  it("sends the title and description to updateMeta at the loaded version, leaving nav out", async () => {
    const user = userEvent.setup();
    const { io } = mount({}, { title: "About", hero: "x" });
    await open(user);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), " About us ");
    await user.type(screen.getByLabelText("Search description"), "Who we are");
    await user.click(save);
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    // No nav key: the page keeps following the site doc's menu.
    expect(io.updateMeta).toHaveBeenCalledWith("about", { title: " About us ", noindex: false, description: "Who we are" }, "v1");
    expect(io.rename).not.toHaveBeenCalled();
  });

  it("sends noindex and an emptied description as they are, the nav toggle read-only without a site menu", async () => {
    const user = userEvent.setup();
    const { io } = mount({ page: info({ nav: true }) }, { title: "About", noindex: true, description: "Old" });
    await open(user);
    const nav = screen.getByLabelText(/Show in navigation/) as HTMLInputElement;
    const noindex = screen.getByLabelText("Hide from search engines") as HTMLInputElement;
    // The same doc answers for "site", and it has no `nav` list: the menu is code.
    expect(io.load).toHaveBeenCalledWith("site");
    expect(nav.checked).toBe(true); // from the published grouping
    expect(nav.disabled).toBe(true);
    expect(screen.getByText(/managed in its code/)).toBeTruthy();
    expect(noindex.checked).toBe(true);
    await user.click(noindex);
    await user.clear(screen.getByLabelText("Search description"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(io.updateMeta).toHaveBeenCalled());
    expect(io.updateMeta).toHaveBeenCalledWith("about", { title: "About", noindex: false, description: "" }, "v1");
  });

  const withSite = (siteMeta: Record<string, unknown>, props: Partial<Parameters<typeof PageSettings>[0]> = {}) => {
    const r = mount(props);
    r.io.load.mockImplementation(async (slug: string) =>
      slug === "site" ? { page: content(siteMeta), version: "s1" } : { page: content({ title: "About" }), version: "v1" }
    );
    return r;
  };

  it("asks updateMeta to add the page to the site doc's menu", async () => {
    const user = userEvent.setup();
    const { io } = withSite({ footer: { blurb: "x" }, nav: [{ label: "Home", href: "/" }] });
    await open(user);
    const nav = screen.getByLabelText(/Show in navigation/) as HTMLInputElement;
    expect(nav.checked).toBe(false);
    expect(screen.getByText(/Arrange the menu in Navigation/)).toBeTruthy();
    await user.click(nav);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect(io.updateMeta).toHaveBeenCalledTimes(1);
    expect(io.updateMeta).toHaveBeenCalledWith("about", { title: "About", noindex: false, description: "", nav: true }, "v1");
  });

  it("asks updateMeta to take the page out of the menu when it is untoggled", async () => {
    const user = userEvent.setup();
    const { io } = withSite({
      nav: [
        { label: "About", href: "/about/", children: [{ label: "Team", href: "/team" }] },
        { label: "More", href: "#", children: [{ label: "About us", href: "/about?ref=nav" }] },
      ],
    });
    await open(user);
    const nav = screen.getByLabelText(/Show in navigation/) as HTMLInputElement;
    expect(nav.checked).toBe(true);
    await user.click(nav);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(io.updateMeta).toHaveBeenCalled());
    expect(io.updateMeta.mock.calls[0]![1].nav).toBe(false);
  });

  it("reports a menu conflict", async () => {
    const user = userEvent.setup();
    const { io } = withSite({ nav: [] }, { home: true });
    io.updateMeta.mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: "s9" } as never);
    await open(user);
    await user.click(screen.getByLabelText(/Show in navigation/));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Someone else changed this page/);
    expect(io.updateMeta.mock.calls[0]![1].nav).toBe(true);
  });

  it("shows the conflict message and stays open when the page changed meanwhile", async () => {
    const user = userEvent.setup();
    const { io } = mount();
    io.updateMeta.mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: "v9" } as never);
    await open(user);
    await user.click(screen.getByLabelText("Hide from search engines"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Someone else changed this page/);
    expect(screen.getByRole("form")).toBeTruthy();
  });

  it("shows a thrown save error inline", async () => {
    const user = userEvent.setup();
    const { io } = mount();
    io.updateMeta.mockRejectedValueOnce(new Error("typren: unauthorized"));
    await open(user);
    await user.click(screen.getByLabelText("Hide from search engines"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("typren: unauthorized");
  });

  it("shows a load error inline", async () => {
    const user = userEvent.setup();
    const { io } = mount();
    io.load.mockRejectedValueOnce("offline");
    await user.click(screen.getByRole("button", { name: "Settings for About" }));
    expect((await screen.findByRole("alert")).textContent).toBe("offline");
  });

  it("validates the slug against its siblings, then renames within the parent", async () => {
    const user = userEvent.setup();
    const { io, onRenamed } = mount({ page: info({ slug: "docs/about" }) });
    await open(user);
    expect(screen.getByText("/docs/")).toBeTruthy();
    const slug = screen.getByLabelText("Slug");
    await user.clear(slug);
    await user.type(slug, "Blog");
    expect(screen.getByRole("alert").textContent).toBe("Use lowercase letters.");
    await user.clear(slug);
    await user.type(slug, "blog");
    expect(screen.getByRole("alert").textContent).toBe("That slug is already used here.");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(slug);
    await user.type(slug, "team");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("docs/team"));
    expect(io.rename).toHaveBeenCalledWith("docs/about", "docs/team");
    expect(io.updateMeta).not.toHaveBeenCalled();
  });

  it("reports a rename the adapter refuses as a taken slug", async () => {
    const user = userEvent.setup();
    const { io, onRenamed } = mount();
    io.rename.mockResolvedValueOnce({ ok: false, code: "conflict" } as never);
    await open(user);
    await user.clear(screen.getByLabelText("Slug"));
    await user.type(screen.getByLabelText("Slug"), "team");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That slug is already used here.");
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it("locks the slug of a page with pages under it, and without rename", async () => {
    const user = userEvent.setup();
    mount({ nested: true });
    await open(user);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText("Move the pages under it first.")).toBeTruthy();
    cleanup();
    render(
      <PortalContext.Provider value={document.body}>
        <PageSettings page={info()} home={false} siblings={[]} nested={false} pending={false} triggerClassName="" onDelete={vi.fn()} onRenamed={vi.fn()} />
      </PortalContext.Provider>
    );
    await user.click(screen.getByRole("button", { name: "Settings for About" }));
    // Without io: status, a read-only slug and delete only.
    expect(((await screen.findByLabelText("Slug")) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete page" })).toBeTruthy();
  });

  it("doesn't let the home page be deleted or renamed, and says why", async () => {
    const user = userEvent.setup();
    const { onDelete } = mount({ home: true, page: info({ slug: "home", title: "Home", hasDraft: true }) });
    await open(user, "Home");
    expect(screen.getByText("Published, with unpublished changes")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete page" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The home page can't be deleted.")).toBeTruthy();
    expect(screen.getByText("The home page keeps its slug.")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("hands delete to the row, closing first", async () => {
    const user = userEvent.setup();
    const { onDelete } = mount({ page: info({ published: false }) });
    await open(user);
    expect(screen.getByText("Draft, never published")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete page" }));
    expect(onDelete).toHaveBeenCalledWith("about");
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });

  it("saves the loaded page's slices as a page template under a name it asks for", async () => {
    const user = userEvent.setup();
    const saveTemplate = vi.fn(async () => ({}));
    const { io } = mount();
    cleanup();
    mount({ io: { ...io, saveTemplate } });
    await open(user);
    await user.click(screen.getByRole("button", { name: "Save as page template" }));
    const name = screen.getByLabelText("Template name") as HTMLInputElement;
    expect(name.value).toBe("About");
    await user.clear(name);
    expect((screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Enter}");
    expect(saveTemplate).not.toHaveBeenCalled();
    await user.type(name, "Landing{Enter}");
    await waitFor(() => expect(saveTemplate).toHaveBeenCalledWith("Landing", [{ slice: "Hero" }]));
    expect(screen.getByRole("status").textContent).toBe("Saved as the page template “Landing”.");
    expect(screen.queryByLabelText("Template name")).toBeNull();

    saveTemplate.mockRejectedValueOnce(new Error("disk full"));
    await user.click(screen.getByRole("button", { name: "Save as page template" }));
    await user.type(screen.getByLabelText("Template name"), "{Enter}");
    expect(await screen.findByText("Couldn’t save the template: disk full")).toBeTruthy();
  });

  it("offers no page template save without saveTemplate", async () => {
    const user = userEvent.setup();
    mount();
    await open(user);
    expect(screen.queryByRole("button", { name: "Save as page template" })).toBeNull();
  });
});
