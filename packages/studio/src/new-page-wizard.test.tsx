import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageInfo, PageTemplate } from "@typren/core";
import { NewPageWizard } from "./new-page-wizard";
import type { TyprenStudioHost } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const p = (slug: string): PageInfo => ({ slug, title: slug, hasDraft: false, locales: ["en"] });
const pages = [p("home"), p("event"), p("event/1")];
const landing: PageTemplate = { id: "t1", name: "Landing", savedAt: "2026-10-01T12:00:00Z", slices: [{ slice: "hero" }, { slice: "cta" }] };

function mount(props: Partial<Parameters<typeof NewPageWizard>[0]> = {}, templates: PageTemplate[] = [landing]) {
  const host = {
    sliceNames: ["cta"],
    defaults: { cta: { text: "Go" } },
    library: {
      list: vi.fn(async () => [{ id: "s1", name: "Launch hero", savedAt: "2026-10-01T12:00:00Z", slice: { slice: "hero", title: "Launch" } }]),
      templates: { list: vi.fn(async () => templates) },
    },
  } as unknown as TyprenStudioHost;
  const fns = {
    onClose: vi.fn(),
    onPage: vi.fn(async () => {}),
    onFolder: vi.fn(async () => {}),
  };
  render(<NewPageWizard host={host} pages={pages} folders={["kept"]} {...fns} {...props} />);
  return fns;
}

const ok = () => screen.getByRole("button", { name: /^(OK|Create page|Add folder)$/ }) as HTMLButtonElement;
const step = () => screen.getByRole("progressbar").getAttribute("aria-valuetext");

describe("NewPageWizard", () => {
  it("asks one question a step: title, location, URL from the title, start, review, then creates", async () => {
    const user = userEvent.setup();
    const fns = mount();
    expect(screen.getByRole("dialog", { name: "What’s this page called?" })).toBeTruthy();
    expect(ok().disabled).toBe(true);
    await user.keyboard("{Enter}");
    expect(step()).toBe("Step 1 of 5");
    await user.type(screen.getByLabelText("Title"), "Day Three{Enter}");

    expect(step()).toBe("Step 2 of 5");
    const locations = within(screen.getByRole("radiogroup", { name: "Location" })).getAllByRole("radio");
    expect(locations.map((r) => r.closest("label")!.textContent)).toEqual(["/The site root", "/home", "/event", "/event/1", "/kept"]);
    await user.click(locations[2]!);
    await user.keyboard("{Enter}");

    expect(step()).toBe("Step 3 of 5");
    const slug = screen.getByLabelText("Slug") as HTMLInputElement;
    expect(slug.value).toBe("day-three");
    expect(screen.getByRole("dialog").textContent).toContain("/event/day-three");
    await user.clear(slug);
    await user.type(slug, "1");
    expect(screen.getByRole("alert").textContent).toBe("That slug is already used here.");
    expect(ok().disabled).toBe(true);
    await user.type(slug, "{Backspace}Bad");
    expect(screen.getByRole("alert").textContent).toBe("Use lowercase letters.");
    await user.clear(slug);
    await user.type(slug, "3{Enter}");

    expect(step()).toBe("Step 4 of 5");
    expect((screen.getByRole("radio", { name: /Blank/ }) as HTMLInputElement).checked).toBe(true);
    await user.keyboard("{Enter}");
    expect(step()).toBe("Step 5 of 5");
    expect(screen.getByRole("dialog").textContent).toContain("A blank page");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fns.onPage).toHaveBeenCalledWith("Day Three", "event/3", []));
  });

  it("goes back a step, and cancels from its button", async () => {
    const user = userEvent.setup();
    const fns = mount();
    expect((screen.getByRole("button", { name: /Back/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Title"), "About{Enter}");
    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("About");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fns.onClose).toHaveBeenCalled();
  });

  it("starts from a page template, preselected when opened from one", async () => {
    const user = userEvent.setup();
    const extra = { ...landing, id: "t0", name: "Other" };
    const fns = mount({ template: landing }, [extra]);
    await user.type(screen.getByLabelText("Title"), "Promo{Enter}{Enter}{Enter}");
    expect(step()).toBe("Step 4 of 5");
    expect((screen.getByRole("radio", { name: /From a page template/ }) as HTMLInputElement).checked).toBe(true);
    const gallery = await screen.findByRole("radiogroup", { name: "Page template" });
    await waitFor(() => expect(within(gallery).getAllByRole("radio")).toHaveLength(2));
    expect((within(gallery).getByRole("radio", { name: /Landing/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.getByRole("dialog").textContent).toContain("The Landing template, 2 sections");
    await user.click(ok());
    await waitFor(() => expect(fns.onPage).toHaveBeenCalledWith("Promo", "promo", landing.slices));
  });

  it("needs a template picked on that path, and says when there are none", async () => {
    const user = userEvent.setup();
    mount({}, []);
    await user.type(screen.getByLabelText("Title"), "Promo{Enter}{Enter}{Enter}");
    await user.click(screen.getByRole("radio", { name: /From a page template/ }));
    expect(screen.getByText(/No page templates yet/).closest("[data-slot=empty]")).toBeTruthy();
    expect(ok().disabled).toBe(true);
  });

  it("assembles sections in a sandbox with a live preview", async () => {
    const user = userEvent.setup();
    const fns = mount();
    await user.type(screen.getByLabelText("Title"), "Promo{Enter}{Enter}{Enter}");
    await user.click(screen.getByRole("radio", { name: /Assemble sections/ }));
    expect(screen.getByText(/No sections yet/).closest("[data-slot=empty]")).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Add section" }));
    await user.click(await screen.findByRole("option", { name: "Launch hero" }));
    await user.click(screen.getByRole("combobox", { name: "Add section" }));
    await user.click(await screen.findByRole("option", { name: "Cta" }));
    await user.click(screen.getByRole("button", { name: "Move Cta up" }));
    expect(within(screen.getByLabelText("Preview")).getAllByText(/^(hero|cta)$/).map((e) => e.textContent)).toEqual(["cta", "hero"]);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.getByRole("dialog").textContent).toContain("2 sections");
    await user.click(ok());
    await waitFor(() => expect(fns.onPage).toHaveBeenCalledWith("Promo", "promo", [{ slice: "cta", text: "Go" }, { slice: "hero", title: "Launch" }]));
  });

  it("shows a failed create and stays open", async () => {
    const user = userEvent.setup();
    const fns = mount();
    fns.onPage.mockRejectedValueOnce(new Error("disk full"));
    await user.type(screen.getByLabelText("Title"), "Promo{Enter}{Enter}{Enter}{Enter}{Enter}");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "disk full");
    expect(ok().disabled).toBe(false);
  });

  it("makes only a folder: where and what to call it", async () => {
    const user = userEvent.setup();
    const fns = mount();
    await user.type(screen.getByLabelText("Title"), "Events");
    await user.click(screen.getByRole("button", { name: /Only a folder/ }));
    expect(screen.getByRole("dialog", { name: "Where should the folder live?" })).toBeTruthy();
    expect(step()).toBe("Step 1 of 3");
    await user.keyboard("{Enter}");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("events");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Add this folder?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await user.click(screen.getByRole("button", { name: /Back/ }));
    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByLabelText("Title")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Only a folder/ }));
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(fns.onFolder).toHaveBeenCalledWith("events"));
  });

  it("offers no folder without onFolder", () => {
    mount({ onFolder: undefined });
    expect(screen.queryByRole("button", { name: /Only a folder/ })).toBeNull();
  });
});
