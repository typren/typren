import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageContent, PageInfo } from "@typren/core";
import { TyprenEditor, type TyprenEditorHost } from "./typren-editor";

afterEach(cleanup);

const actions = {
  createPage: vi.fn(async (title: string) => title),
  deletePage: vi.fn(async () => {}),
  saveDraft: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  publish: vi.fn(async () => ({ ok: true as const, version: "v1" })),
  discardDraft: vi.fn(async () => {}),
} as unknown as PageActions;

const host: TyprenEditorHost = { actions, sliceNames: [], defaults: {}, previewPath: "/preview" };
const pages: PageInfo[] = [];
const page: PageContent = { meta: {}, slices: [], body: "" };

// Both branches (`typren-editor.tsx`'s picker div and `EditorShell`'s root)
// share these exact takeover classes today; a consumer that never passes
// `layout` must keep getting byte-identical markup.
const TAKEOVER_CLASSES = "fixed inset-0 z-[100] flex bg-[var(--typren-bg)] text-[var(--typren-fg)]";

describe("TyprenEditor layout", () => {
  it("picker view defaults to the takeover overlay, byte-identical to today's classes", () => {
    const { container } = render(
      <TyprenEditor host={host} pages={pages} onNavigate={() => {}} onReload={() => {}} />
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe(TAKEOVER_CLASSES);
  });

  it('picker view with layout="embedded" fills its parent, no fixed positioning', () => {
    const { container } = render(
      <TyprenEditor host={host} pages={pages} layout="embedded" onNavigate={() => {}} onReload={() => {}} />
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/\bfixed\b/);
    expect(root.className).not.toMatch(/z-\[100\]/);
    expect(root.className).toContain("h-full");
  });

  it("editor shell defaults to the takeover overlay, byte-identical to today's classes", () => {
    const { container } = render(
      <TyprenEditor
        host={host}
        pages={pages}
        slug="home"
        page={page}
        onNavigate={() => {}}
        onReload={() => {}}
      />
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe(TAKEOVER_CLASSES);
  });

  it('editor shell with layout="embedded" fills its parent, no fixed positioning', () => {
    const { container } = render(
      <TyprenEditor
        host={host}
        pages={pages}
        slug="home"
        page={page}
        layout="embedded"
        onNavigate={() => {}}
        onReload={() => {}}
      />
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/\bfixed\b/);
    expect(root.className).not.toMatch(/z-\[100\]/);
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("min-h-0");
  });
});
