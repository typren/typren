import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageContent } from "@typren/core";
import { EditorShell } from "./editor-shell";

afterEach(cleanup);

const actions = {
  createPage: vi.fn(async (title: string) => title),
  deletePage: vi.fn(async () => {}),
  saveDraft: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  publish: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  discardDraft: vi.fn(async () => {}),
} as unknown as PageActions;

const page: PageContent = { meta: {}, slices: [{ slice: "hero", title: "Old copy" }], body: "" };

function mount() {
  const { container } = render(
    <EditorShell
      slug="home"
      pages={[]}
      initialPage={page}
      initialVersion={null}
      sliceNames={["hero"]}
      defaults={{}}
      previewPath="/editor/preview"
      actions={actions}
      onNavigate={() => {}}
      onReload={() => {}}
    />
  );
  return container.querySelector("iframe")!;
}

const edit = { __typren: true, type: "edit", index: 0, before: "Old copy", after: "Injected" };
const post = (data: unknown, source: MessageEventSource | null, origin: string) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
  });

describe("EditorShell preview isolation", () => {
  it("sandboxes the preview frame without allow-same-origin", () => {
    const tokens = (mount().getAttribute("sandbox") ?? "").split(/\s+/);
    expect(tokens).toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
  });

  it("applies an edit sent by its own preview frame, whose sandboxed origin is opaque", () => {
    const frame = mount();
    post(edit, frame.contentWindow, "null");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("ignores a same-origin edit from any window other than the preview frame", () => {
    mount();
    post(edit, window, window.location.origin);
    post({ ...edit, index: "0" }, window, window.location.origin);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("ignores a frame message whose index is not an integer", () => {
    const frame = mount();
    post({ ...edit, index: 0.5 }, frame.contentWindow, "null");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
});
