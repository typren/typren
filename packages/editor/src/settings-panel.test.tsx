import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteSettings } from "@typren/core";
import type { TyprenEditorSettingsActions } from "./types";
import { SettingsPanel } from "./settings-panel";

afterEach(cleanup);

const snapshot: SiteSettings = {
  brand: { name: "Acme" },
  seo: { description: "Acme site" },
  bootstrap: { adminRoute: "editor", locales: ["en"], defaultLocale: "en", routing: "prefix-except-default", onboarded: true },
};

function makeSettings(): TyprenEditorSettingsActions {
  return {
    saveDraft: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    publish: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    writeBootstrap: vi.fn(async () => {}),
  };
}

describe("SettingsPanel", () => {
  it("renders a not-configured message when no settings actions are wired", () => {
    render(<SettingsPanel onReload={() => {}} />);
    expect(screen.getByText(/aren.t configured/)).toBeTruthy();
  });

  it("seeds its form from the host-fetched snapshot", () => {
    render(<SettingsPanel settings={makeSettings()} snapshot={snapshot} onReload={() => {}} />);
    expect(screen.getByDisplayValue("Acme")).toBeTruthy();
    expect(screen.getByDisplayValue("Acme site")).toBeTruthy();
  });

  it("Publish calls saveDraft then publish, then reloads", async () => {
    const settings = makeSettings();
    const onReload = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel settings={settings} snapshot={snapshot} version="v1" onReload={onReload} />);

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(settings.saveDraft).toHaveBeenCalledWith(snapshot, "v1", undefined);
    expect(settings.publish).toHaveBeenCalledWith("v2", undefined);
  });

  it("a conflicting saveDraft shows the conflict banner instead of publishing", async () => {
    const settings: TyprenEditorSettingsActions = {
      saveDraft: vi.fn(async () => ({ ok: false as const, code: "conflict" as const, currentVersion: "v9" })),
      publish: vi.fn(async () => ({ ok: true as const, version: "v9" })),
      writeBootstrap: vi.fn(async () => {}),
    };
    const user = userEvent.setup();
    render(<SettingsPanel settings={settings} snapshot={snapshot} version="v1" onReload={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(settings.publish).not.toHaveBeenCalled();
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
});
