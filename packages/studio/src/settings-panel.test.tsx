import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteSettings } from "@typren/core";
import type { TyprenStudioSettingsActions } from "./types";
import { SettingsPanel } from "./settings-panel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Autosave's 0.8s debounce, driven by hand: only setTimeout is faked, so
// Testing Library's own waits stay on real timers until it is.
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const editName = (value: string) => fireEvent.change(screen.getByDisplayValue("Acme"), { target: { value } });

const snapshot: SiteSettings = {
  brand: { name: "Acme" },
  seo: { description: "Acme site" },
  bootstrap: { adminRoute: "editor", locales: ["en"], defaultLocale: "en", routing: "prefix-except-default", onboarded: true },
};

function makeSettings(): TyprenStudioSettingsActions {
  return {
    saveDraft: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    publish: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    writeBootstrap: vi.fn(async () => {}),
  };
}

const iconOf = (text: HTMLElement) => text.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
describe("SettingsPanel", () => {
  it("renders a not-configured message when no settings actions are wired", () => {
    render(<SettingsPanel onReload={() => {}} />);
    expect(iconOf(screen.getByText(/aren.t configured/))).toBeTruthy();
  });

  it("seeds its form from the host-fetched snapshot", () => {
    render(<SettingsPanel settings={makeSettings()} snapshot={snapshot} onReload={() => {}} />);
    expect(screen.getByDisplayValue("Acme")).toBeTruthy();
    expect(screen.getByDisplayValue("Acme site")).toBeTruthy();
  });

  it("Advanced panel: saving a valid admin route calls writeBootstrap", async () => {
    const settings = makeSettings();
    const user = userEvent.setup();
    render(<SettingsPanel settings={settings} snapshot={snapshot} onReload={() => {}} />);

    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    const routeField = screen.getByDisplayValue("editor");
    await user.clear(routeField);
    await user.type(routeField, "admin");
    await user.click(screen.getByRole("button", { name: "Save advanced settings" }));

    await waitFor(() =>
      expect(settings.writeBootstrap).toHaveBeenCalledWith({
        adminRoute: "admin",
        locales: ["en"],
        defaultLocale: "en",
        routing: "prefix-except-default",
      })
    );
  });

  it("hideAdminRoute drops the admin-route field and never writes it", async () => {
    const settings = { ...makeSettings(), hideAdminRoute: true };
    const user = userEvent.setup();
    render(
      <SettingsPanel
        settings={settings}
        snapshot={{
          ...snapshot,
          bootstrap: { ...snapshot.bootstrap, adminRoute: "" },
        }}
        onReload={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.queryByText("Admin route")).toBeNull();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "prefix-all" }));
    await user.click(screen.getByRole("button", { name: "Save advanced settings" }));

    await waitFor(() => expect(settings.writeBootstrap).toHaveBeenCalled());
    expect(settings.writeBootstrap).toHaveBeenCalledWith(expect.not.objectContaining({ adminRoute: expect.anything() }));
  });

  it("hides the Advanced panel when the host has no writeBootstrap", () => {
    const settings = { ...makeSettings(), writeBootstrap: undefined };
    render(<SettingsPanel settings={settings} snapshot={snapshot} onReload={() => {}} />);
    expect(screen.queryByRole("button", { name: /Advanced/ })).toBeNull();
  });

  it("keeps the style tokens and a stored theme, which it no longer edits, when a Settings field is edited", async () => {
    const settings = makeSettings();
    const styled = { ...snapshot, theme: { preset: "neutral" as const }, style: { "--typren-primary": "#112233" } };
    render(<SettingsPanel settings={settings} snapshot={styled} version="v1" onReload={() => {}} />);
    expect(screen.queryByText("Theme preset")).toBeNull();
    fakeTimers();
    editName("Acme!");
    await tick(800);
    expect(settings.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ theme: { preset: "neutral" }, style: { "--typren-primary": "#112233" } }),
      "v1",
      undefined
    );
  });


  it("autosaves the draft without bootstrap, then Publish publishes it and reloads", async () => {
    const settings = makeSettings();
    const onReload = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel settings={settings} snapshot={snapshot} version="v1" onReload={onReload} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await user.type(screen.getByDisplayValue("Acme"), "!");
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(settings.saveDraft).toHaveBeenCalledWith({ brand: { name: "Acme!" }, seo: { description: "Acme site" } }, "v1", undefined);
    expect(settings.publish).toHaveBeenCalledWith("v2", undefined);
  });

  it("a conflicting save shows the banner, never Saved, and Overwrite writes without a version", async () => {
    const settings: TyprenStudioSettingsActions = {
      ...makeSettings(),
      saveDraft: vi.fn(async (_n: unknown, base?: string) =>
        base ? { ok: false as const, code: "conflict" as const, currentVersion: "v9" } : { ok: true as const, version: "v10" }
      ),
    };
    render(<SettingsPanel settings={settings} snapshot={snapshot} version="v1" onReload={() => {}} />);
    fakeTimers();
    editName("Acme!");
    await tick(800);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Not saved: changed elsewhere")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await tick(0);
    expect(settings.publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    await tick(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(settings.saveDraft).toHaveBeenLastCalledWith(expect.anything(), undefined, undefined);
    expect(screen.getByText("Saved just now")).toBeTruthy();
  });

  it("with git, shows the status and the settings history, and no Publish", async () => {
    const settings = { ...makeSettings(), history: vi.fn(async () => [{ hash: "abc1234", subject: "content: update settings", author: "Ada", date: new Date().toISOString() }]) };
    const git = { outgoing: vi.fn(async () => ({ branch: "", upstream: null, commits: [] })), pending: vi.fn(async () => []), push: vi.fn(), discard: vi.fn() };
    render(<SettingsPanel settings={settings} git={git} snapshot={snapshot} version="v1" onReload={() => {}} />);
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain("Check out a branch");
    act(() => screen.getByRole("button", { name: /Version history/ }).focus());
    expect((await screen.findByRole("list", { name: "Version history" })).textContent).toContain("content: update settings");
    expect(settings.history).toHaveBeenCalledWith(undefined);
  });
});
