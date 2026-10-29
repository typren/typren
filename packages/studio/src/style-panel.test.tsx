import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STYLE_MAP_DEFAULT, type SiteSettings } from "@typren/core";
import type { TyprenStudioHost, TyprenStudioSettingsActions } from "./types";
import { StyleLevel, StylePanel, readNames, siteStyle, useStyleDraft, type StyleScreenId } from "./style-panel";
import { useSettingsDraft } from "./settings-panel";
import { FONT_PRESETS } from "./style-type";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Autosave's 0.8s debounce, driven by hand: only setTimeout is faked, right
// before the edit, so Testing Library's own waits stay on real timers.
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const snapshot: SiteSettings = {
  brand: { name: "Acme" },
  seo: {},
  style: { "--typren-primary": "#112233" },
  bootstrap: { adminRoute: "editor", locales: ["en"], defaultLocale: "en", routing: "prefix-except-default", onboarded: true },
};

function makeSettings(over: Partial<TyprenStudioSettingsActions> = {}): TyprenStudioSettingsActions {
  return {
    saveDraft: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    publish: vi.fn(async () => ({ ok: true as const, version: "v3" })),
    discardDraft: vi.fn(async () => {}),
    writeBootstrap: vi.fn(async () => {}),
    ...over,
  };
}

type Props = {
  host: Pick<TyprenStudioHost, "settings" | "git" | "styleMap">;
  snap?: SiteSettings;
  version?: string;
  screen?: StyleScreenId;
  onReload?: () => void;
  onReview?: () => void;
};

/** What the shell does: the settings doc's draft, Style's view of it, its controls in the top bar, the banner and the panel. */
function Harness({ host, snap = snapshot, version = "v1", screen: id, onReload = () => {}, onReview }: Readonly<Props>) {
  const settings = useSettingsDraft({ host, snapshot: snap, version, onReload, onReview });
  const draft = useStyleDraft({ draft: settings, styleMap: host.styleMap });
  return (
    <>
      <div role="toolbar">{draft.actions}</div>
      {draft.banner}
      <StylePanel screen={id} draft={draft} previewSrc="/p" device="desktop" />
    </>
  );
}

const mount = (props: Props) => render(<Harness {...props} />);
const bar = () => within(screen.getByRole("toolbar"));

/** Answers as the preview bridge would, from the hidden preview frame. */
function reply(data: Record<string, unknown>) {
  const frame = screen.getByTitle("Live preview") as HTMLIFrameElement;
  act(() => {
    // "/p" is the studio's own origin, so the sandboxed frame posts as "null".
    window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, ...data }, source: frame.contentWindow, origin: "null" }));
  });
}

const iconOf = (text: HTMLElement) => text.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
describe("siteStyle", () => {
  // Generic fixtures: a site styled with stock shadcn variables, read through
  // the default map, and one whose CSS uses its own names through a custom map.
  it("reads a shadcn-only site through the default map", () => {
    const got = siteStyle(
      {
        vars: { "--primary": "rgb(10, 20, 30)", "--background": "rgb(255, 255, 255)", "--radius": "0.5rem", "--typren-primary": "red" },
        elements: {
          html: { background: "rgb(1, 2, 3)" },
          body: { background: "rgba(0, 0, 0, 0)", color: "rgb(0, 0, 0)", fontFamily: "Inter", fontSize: "16px", lineHeight: "24px" },
          h1: { fontFamily: "Serif", fontSize: "40px", lineHeight: "48px" },
          h2: { fontSize: "32px" },
        },
      },
      STYLE_MAP_DEFAULT
    );
    expect(got).toEqual({
      "--typren-primary": "rgb(10, 20, 30)",
      "--typren-bg": "rgb(255, 255, 255)",
      "--typren-radius": "0.5rem",
      "--typren-font-body": "Inter",
      "--typren-font-heading": "Serif",
      "--typren-font-size": "16px",
      "--typren-line-height": "1.5",
      "--typren-heading-line-height": "1.2",
    });
  });

  it("reads a site with its own names through its map, and takes no guesses for colours", () => {
    const map = { "--typren-accent": "--surface-raised", "--typren-primary": "--typren-primary", "--typren-font-body": "--font-copy" };
    const got = siteStyle(
      {
        vars: { "--surface-raised": "rgb(9, 9, 9)", "--typren-primary": "rgb(1, 1, 1)", "--primary": "rgb(2, 2, 2)", "--font-copy": "Lato" },
        elements: { body: { background: "transparent", color: "rgb(0, 0, 0)", fontFamily: "Arial", lineHeight: "normal", fontSize: "16px" } },
      },
      map
    );
    expect(got["--typren-accent"]).toBe("rgb(9, 9, 9)");
    expect(got["--typren-primary"]).toBe("rgb(1, 1, 1)");
    expect(got["--typren-font-body"]).toBe("Lato");
    expect(got["--typren-bg"]).toBeUndefined();
    expect(got["--typren-line-height"]).toBeUndefined();
    expect(readNames(map)).toContain("--surface-raised");
    expect(siteStyle({}, map)).toEqual({});
  });
});

describe("StylePanel", () => {
  it("says so when settings are not wired", () => {
    mount({ host: {} });
    expect(iconOf(screen.getByText(/isn.t configured/))).toBeTruthy();
    expect(screen.getByRole("toolbar").childElementCount).toBe(0);
  });

  it("opens on the palette, grouped, and shows the site's own value for an unset token", () => {
    mount({ host: { settings: makeSettings() } });
    for (const g of ["Brand", "Surfaces", "Text", "Borders"]) expect(screen.getByRole("listbox", { name: g })).toBeTruthy();
    expect(within(screen.getByRole("option", { name: "Primary" })).getByText("#112233")).toBeTruthy();
    expect(within(screen.getByRole("option", { name: "Accent" })).getAllByText(/Not set/).length).toBeGreaterThan(0);
    reply({ type: "computedStyle", vars: { "--accent": "rgb(0, 128, 0)" } });
    const accent = within(screen.getByRole("option", { name: "Accent" }));
    expect(accent.getByText("rgb(0, 128, 0)")).toBeTruthy();
    expect(accent.getByText("From site")).toBeTruthy();
  });

  it("asks the preview for the mapped names on load and when the bridge starts", () => {
    mount({ host: { settings: makeSettings(), styleMap: { "--typren-primary": "--brand" } } });
    const frame = screen.getByTitle("Live preview") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    reply({ type: "location", path: "/" });
    fireEvent.load(frame);
    const asks = post.mock.calls.filter(([m]) => (m as { type: string }).type === "computedStyle");
    expect(asks).toHaveLength(2);
    expect((asks[0]![0] as { names: string[]; colors: string[] }).colors).toContain("--brand");
  });

  it("autosaves the draft 0.8s after the edit, without bootstrap, and has no Save button", async () => {
    const settings = makeSettings();
    mount({ host: { settings } });
    expect(bar().queryByRole("button", { name: "Save" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("option", { name: "Accent" }));
    fakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "Accent" }), { target: { value: "#ff0000" } });
    expect(within(screen.getByRole("option", { name: "Accent" })).getByText("#ff0000")).toBeTruthy();
    expect(bar().getByText("Saving…")).toBeTruthy();
    await tick(799);
    expect(settings.saveDraft).not.toHaveBeenCalled();
    await tick(1);
    expect(settings.saveDraft).toHaveBeenCalledWith(
      { brand: { name: "Acme" }, seo: {}, style: { "--typren-primary": "#112233", "--typren-accent": "#ff0000" } },
      "v1",
      undefined
    );
    expect(settings.publish).not.toHaveBeenCalled();
    expect(bar().getByText("Saved just now")).toBeTruthy();
  });

  it("keeps the draft across screens and saves the type and shape tokens too", async () => {
    const settings = makeSettings();
    const user = userEvent.setup();
    const { rerender } = mount({ host: { settings }, screen: "shape" });
    await user.click(screen.getByRole("option", { name: "Corner radius" }));
    fakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "Corner radius" }), { target: { value: "8px" } });
    rerender(<Harness host={{ settings }} screen="type" />);
    fireEvent.click(screen.getByRole("option", { name: "Body" }));
    fireEvent.click(screen.getByRole("button", { name: /Serif/ }));
    await tick(800);
    expect(settings.saveDraft).toHaveBeenCalledOnce();
    expect(settings.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        style: { "--typren-primary": "#112233", "--typren-radius": "8px", "--typren-font-body": FONT_PRESETS[2].value },
      }),
      "v1",
      undefined
    );
  });

  it("holds the autosave while a value is invalid", async () => {
    vi.stubGlobal("CSS", { supports: (_p: string, v: string) => v !== "nope" });
    const settings = makeSettings();
    mount({ host: { settings } });
    await userEvent.setup().click(screen.getByRole("option", { name: "Accent" }));
    fakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "Accent" }), { target: { value: "nope" } });
    expect(screen.getByRole("alert").textContent).toMatch(/Not a colour/);
    await tick(5000);
    expect(settings.saveDraft).not.toHaveBeenCalled();
    expect(bar().getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
  });

  it("Discard drops the saved draft after a confirm, and reloads", async () => {
    const settings = makeSettings();
    const onReload = vi.fn();
    const user = userEvent.setup();
    mount({ host: { settings }, onReload });
    expect(bar().queryByRole("button", { name: "Discard" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Primary" }));
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    await user.click(bar().getByRole("button", { name: "Discard" }));
    await answer("Cancel");
    expect(settings.discardDraft).not.toHaveBeenCalled();
    await user.click(bar().getByRole("button", { name: "Discard" }));
    await answer("Discard");
    await waitFor(() => expect(settings.discardDraft).toHaveBeenCalledWith(undefined));
    expect(onReload).toHaveBeenCalled();
  });

  it("Publish publishes the saved draft, then reloads, and a new version starts the draft over", async () => {
    const settings = makeSettings();
    const onReload = vi.fn();
    const { rerender } = mount({ host: { settings }, snap: snapshot, onReload });
    await userEvent.setup().click(bar().getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(settings.publish).toHaveBeenCalledWith("v1", undefined);
    rerender(<Harness host={{ settings }} snap={{ ...snapshot, style: { "--typren-primary": "#445566" } }} version="v3" />);
    expect(within(screen.getByRole("option", { name: "Primary" })).getByText("#445566")).toBeTruthy();
  });

  it("never reads Saved after a lost race or a failed write", async () => {
    const settings = makeSettings({
      saveDraft: vi.fn(async () => ({ ok: false as const, code: "conflict" as const, currentVersion: "v9" })),
    });
    const onReload = vi.fn();
    const user = userEvent.setup();
    mount({ host: { settings }, onReload });
    await user.click(screen.getByRole("option", { name: "Primary" }));
    fakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    await tick(800);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(bar().getByText("Not saved: changed elsewhere")).toBeTruthy();
    expect(bar().getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalled();
    cleanup();
    vi.useRealTimers();
    mount({ host: { settings: makeSettings({ saveDraft: vi.fn(async () => { throw new Error("disk full"); }) }) } });
    await user.click(screen.getByRole("option", { name: "Primary" }));
    fakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    await tick(800);
    expect(screen.getByText(/disk full/)).toBeTruthy();
    expect(bar().getByText("Not saved")).toBeTruthy();
  });

  it("in a local git checkout, autosave never publishes and Review saves first, then opens the shell's panel", async () => {
    const settings = makeSettings();
    const git = { outgoing: vi.fn(async () => ({ branch: "main", upstream: "origin/main", commits: [] })), pending: vi.fn(async () => []), push: vi.fn(), discard: vi.fn() };
    const onReview = vi.fn();
    const user = userEvent.setup();
    mount({ host: { settings, git }, onReview });
    expect(bar().queryByRole("button", { name: "Publish" })).toBeNull();
    await waitFor(() => expect(bar().getByRole("button", { name: "Review" })).toHaveProperty("disabled", true));
    // Review leads; the save status sits at the bar's edge after it.
    expect(bar().getByRole("button", { name: "Review" }).compareDocumentPosition(bar().getByText("Up to date")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Accent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Accent" }), { target: { value: "#00ff00" } });
    await user.click(bar().getByRole("button", { name: "Review" }));
    expect(settings.saveDraft).toHaveBeenCalled();
    expect(settings.publish).not.toHaveBeenCalled();
    expect(onReview).toHaveBeenCalled();
  });

  it("shows the site preview on demand, keeps the side panel, and posts the draft under its mapped names", async () => {
    const user = userEvent.setup();
    mount({ host: { settings: makeSettings() } });
    const frame = screen.getByTitle("Live preview") as HTMLIFrameElement;
    expect(frame.closest(".hidden")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Accent" }));
    await user.click(screen.getByRole("button", { name: "Preview site" }));
    expect(frame.closest(".hidden")).toBeNull();
    expect(screen.queryByRole("listbox", { name: "Brand" })).toBeNull();
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.change(screen.getByRole("textbox", { name: "Accent" }), { target: { value: "#00ff00" } });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        {
          __typren: true,
          type: "style",
          vars: { "--typren-primary": "#112233", "--primary": "#112233", "--typren-accent": "#00ff00", "--accent": "#00ff00" },
        },
        "*"
      )
    );
  });

  it("the rail level lists the three screens and opens one", async () => {
    const onOpen = vi.fn();
    render(<StyleLevel current="type" onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: "Type" }).getAttribute("aria-current")).toBe("page");
    await userEvent.setup().click(screen.getByRole("button", { name: "Shape" }));
    expect(onOpen).toHaveBeenCalledWith("shape");
  });
});
