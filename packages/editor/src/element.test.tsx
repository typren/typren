import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions } from "@typren/core";
import { TyprenShellElement, type TyprenShellHost } from "./element";

// This suite drives the custom element imperatively (no @testing-library/react
// `render`), so nothing else flips this on for us — React's own recommendation
// for a custom test runner. See https://react.dev/reference/react/act
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => {
    document.body.innerHTML = "";
  });
});

// Only the two handlers the picker view actually calls; cast past the rest of
// `PageActions` rather than stubbing every action this test never exercises.
const actions = {
  createPage: vi.fn(async (title: string) => title),
  deletePage: vi.fn(async () => {}),
  saveDraft: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  publish: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  discardDraft: vi.fn(async () => {}),
} as unknown as PageActions;

const host: TyprenShellHost = { actions, sliceNames: [], defaults: {}, previewPath: "/preview" };

describe("<typren-shell>", () => {
  it("registers typren-shell and a distinct, deprecated meditor-shell alias", () => {
    const typrenShell = customElements.get("typren-shell");
    const meditorShell = customElements.get("meditor-shell");
    expect(typrenShell).toBe(TyprenShellElement);
    expect(meditorShell).toBeDefined();
    expect(meditorShell).not.toBe(typrenShell);
  });

  it("waits for host/pages/onNavigate/onReload before rendering", () => {
    const el = new TyprenShellElement();
    act(() => {
      document.body.append(el); // connected, but no props set yet
    });
    expect(el.textContent).toBe("");

    act(() => {
      el.host = host;
      el.pages = [];
      el.onNavigate = () => {};
      el.onReload = () => {};
    });
    expect(el.textContent).not.toBe("");
  });

  it("projects a raw DOM topBarSlot node into the shell for non-React hosts", () => {
    const panel = document.createElement("div");
    panel.textContent = "Acme Inc";

    const el = new TyprenShellElement();
    act(() => {
      el.host = { ...host, topBarSlot: panel };
      el.pages = [];
      el.slug = "home";
      el.page = { meta: {}, slices: [], body: "" };
      el.onNavigate = () => {};
      el.onReload = () => {};
      document.body.append(el);
    });

    expect(el.contains(panel)).toBe(true);
    expect(el.textContent).toContain("Acme Inc");
  });

  it("<meditor-shell> warns once and renders through the same pipeline", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = document.createElement("meditor-shell") as unknown as TyprenShellElement;
    act(() => {
      el.host = host;
      el.pages = [];
      el.onNavigate = () => {};
      el.onReload = () => {};
      document.body.append(el);
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
    expect(el.textContent).not.toBe("");
    warn.mockRestore();
  });
});
