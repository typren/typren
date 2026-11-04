import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ConsentBanner } from "./consent-banner";
import { createConsentStore } from "../tags/consent";

const store = () => createConsentStore({ policyVersion: "1" });

afterEach(() => {
  cleanup();
  document.cookie = "typren-consent=; path=/; max-age=0";
});

describe("ConsentBanner", () => {
  it("shows until the visitor decides, and records Accept all", () => {
    const s = store();
    render(<ConsentBanner store={s} policyHref="/cookies" />);
    expect(screen.getByRole("dialog", { name: "We use cookies" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cookie policy" }).getAttribute("href")).toBe("/cookies");
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(s.get()).toMatchObject({ analytics: true, marketing: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("records Reject non-essential as nothing granted", () => {
    const s = store();
    render(<ConsentBanner store={s} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject non-essential" }));
    expect(s.get()).toMatchObject({ analytics: false, marketing: false });
  });

  it("saves per-category choices from the settings panel", () => {
    const s = store();
    render(<ConsentBanner store={s} />);
    fireEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Analytics/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(s.get()).toMatchObject({ analytics: true, marketing: false });
  });

  it("stays hidden for a decided visitor until settings are reopened, prefilled, and closes without deciding", () => {
    const s = store();
    s.set({ analytics: false, marketing: true });
    render(<ConsentBanner store={s} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => s.openSettings());
    expect((screen.getByRole("checkbox", { name: /Marketing/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close cookie settings" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(s.get()).toMatchObject({ analytics: false, marketing: true });
  });

  it("reopens undecided-style settings when no decision is stored", () => {
    const s = store();
    render(<ConsentBanner store={s} heading="Cookies?" />);
    act(() => s.openSettings());
    expect((screen.getByRole("checkbox", { name: /Analytics/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("dialog", { name: "Cookies?" })).toBeTruthy();
  });

  it("renders nothing on the server, so the banner never flashes for a decided visitor", () => {
    expect(renderToString(<ConsentBanner store={store()} />)).toBe("");
  });
});
