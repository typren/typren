import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset, MediaUse } from "@typren/core";
import { AssetViewer, UsageList, totalUses } from "./asset-viewer";

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
const assets = [a("one", { width: 40, height: 20, folder: "events" }), a("two"), a("three")];
const uses: MediaUse[] = [
  { slug: "about", locale: "en", count: 2 },
  { slug: "settings", locale: "en", count: 1 },
];

const mount = (props: Partial<Parameters<typeof AssetViewer>[0]> = {}) => {
  const fns = { onStep: vi.fn(), onClose: vi.fn(), onOpenPage: vi.fn() };
  render(<AssetViewer assets={assets} id="two" mode="full" checker={{}} {...fns} {...props} />);
  return fns;
};

describe("totalUses", () => {
  it("sums counts, and is 0 without usage", () => {
    expect(totalUses(uses)).toBe(3);
    expect(totalUses(undefined)).toBe(0);
  });
});

describe("UsageList", () => {
  it("shows the empty state", () => {
    render(<UsageList uses={[]} />);
    expect(screen.getByText("Not used on any page.")).toBeTruthy();
  });

  it("lists pages and opens them; disabled without a handler", async () => {
    const onOpenPage = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<UsageList uses={uses} onOpenPage={onOpenPage} />);
    await user.click(screen.getByRole("button", { name: /\/about/ }));
    expect(onOpenPage).toHaveBeenCalledWith("about");
    expect(screen.getByRole("button", { name: /Site settings/ })).toBeTruthy();
    unmount();
    render(<UsageList uses={uses} />);
    expect((screen.getByRole("button", { name: /\/about/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AssetViewer", () => {
  it("renders nothing for an unknown id", () => {
    mount({ id: "nope" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pins the properties panel to the viewport on a plain aside, scrolling inside", () => {
    mount();
    const aside = screen.getByRole("dialog").querySelector("aside")!;
    // ScrollArea's root carries an inline `position: relative`, so the pinning class can't sit on it.
    expect(aside.className).toContain("absolute");
    expect(aside.querySelector("[data-slot=scroll-area]")).toBeTruthy();
  });

  it("full mode shows properties and usage", () => {
    mount({ id: "one", uses });
    const dialog = screen.getByRole("dialog", { name: "one.webp" });
    expect(within(dialog).getByText("40×20")).toBeTruthy();
    expect(within(dialog).getByText("events")).toBeTruthy();
    expect(within(dialog).getByText("27 Oct 2026")).toBeTruthy();
    expect(within(dialog).getByText("2 KB")).toBeTruthy();
    expect(within(dialog).getByText("Used 3 times")).toBeTruthy();
    expect(within(dialog).getByText("1 of 3")).toBeTruthy();
  });

  it("lays the header out as arrows and title, then the count and Close", () => {
    mount({ id: "one" });
    const header = screen.getByRole("dialog").querySelector("header")!;
    const order = Array.from(header.querySelectorAll("button, span.truncate, span.tabular-nums")).map(
      (el) => el.getAttribute("aria-label") ?? el.textContent
    );
    expect(order).toEqual(["Previous asset", "Next asset", "one.webp", "1 of 3", "Close"]);
  });

  it("falls back for missing dimensions and folder, and singular usage", () => {
    mount({ uses: [{ slug: "a", locale: "en", count: 1 }] });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("—")).toBeTruthy();
    expect(within(dialog).getByText("All Assets")).toBeTruthy();
    expect(within(dialog).getByText("Used 1 time")).toBeTruthy();
  });

  it("quick mode is the image alone", () => {
    mount({ mode: "quick" });
    expect(screen.getByRole("dialog", { name: "Quick Look: two.webp" })).toBeTruthy();
    expect(screen.queryByText("Properties")).toBeNull();
  });

  it("Copy URL writes to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Copy URL/ }));
    expect(writeText).toHaveBeenCalledWith("/img/two.webp");
  });

  it("an open-page click closes the viewer first", async () => {
    const { onClose, onOpenPage } = mount({ uses });
    await userEvent.setup().click(screen.getByRole("button", { name: /\/about/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenPage).toHaveBeenCalledWith("about");
  });

  it("without onOpenPage the usage rows are inert", () => {
    mount({ uses, onOpenPage: undefined });
    expect((screen.getByRole("button", { name: /\/about/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keys: arrows step, Escape closes, Space closes only quick look", () => {
    const { onStep, onClose } = mount();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).toHaveBeenLastCalledWith("one");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onStep).toHaveBeenLastCalledWith("three");
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: " " });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const quick = mount({ mode: "quick" });
    fireEvent.keyDown(window, { key: " " });
    expect(quick.onClose).toHaveBeenCalled();
  });

  it("stops at the ends, and the arrow buttons step", async () => {
    const { onStep } = mount({ id: "one" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Previous asset" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "Next asset" }));
    expect(onStep).toHaveBeenCalledWith("two");
    cleanup();
    const mid = mount();
    await userEvent.setup().click(screen.getByRole("button", { name: "Previous asset" }));
    expect(mid.onStep).toHaveBeenCalledWith("one");
    cleanup();
    mount({ id: "three" });
    expect((screen.getByRole("button", { name: "Next asset" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("backdrop and Close close; the image and header do not", async () => {
    const { onClose } = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("img"));
    await user.click(screen.getByText("two.webp", { selector: "span" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("AssetViewer modality", () => {
  it("is a modal dialog with focus moved inside", async () => {
    mount();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});
