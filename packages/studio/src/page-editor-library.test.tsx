import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageFlows, PageContent, SliceLibrary } from "@typren/core";
import { useRef, useState } from "react";
import { DevicePreview, type Device } from "./device-preview";
import { Frame } from "./frame";
import { usePageEditor } from "./page-editor";
import type { TyprenStudioHost } from "./types";

afterEach(cleanup);

/** The shell's wiring of edit mode, cut down to one page always in edit mode. */
function PageEditor({
  previewSrc,
  device,
  ...props
}: Omit<Parameters<typeof usePageEditor>[0], "enabled" | "iframeRef" | "onReloadPreview"> & {
  previewSrc: (slug: string, v: number) => string;
  device: Device;
  onDevice: () => void;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [v, setV] = useState(0);
  const edit = usePageEditor({ ...props, enabled: true, iframeRef, onReloadPreview: () => setV((n) => n + 1) })!;
  return (
    <Frame
      device={device}
      onDevice={() => {}}
      dark={false}
      onToggleTheme={() => {}}
      {...edit.frame}
      actions={<button type="button" aria-pressed onClick={edit.leave}>Edit</button>}
    >
      <DevicePreview src={previewSrc(props.slug, v)} device={device} reloadKey={v} iframeRef={iframeRef}>
        {edit.overlay}
      </DevicePreview>
      {edit.dialogs}
    </Frame>
  );
}

const page: PageContent = { meta: {}, slices: [{ slice: "hero", label: "Intro", title: "Hi" }, { slice: "cta" }], body: "" };

function mount(save: SliceLibrary["save"]) {
  const host: TyprenStudioHost = {
    actions: {} as PageActions & PageFlows,
    sliceNames: ["hero"],
    defaults: {},
    previewPath: "/preview",
    library: { list: vi.fn(), save, update: vi.fn(), remove: vi.fn() },
  };
  const { container } = render(
    <PageEditor
      host={host}
      slug="home"
      pill={{ title: "Home", url: "/", hasDraft: false }}
      initialPage={page}
      initialVersion="v1"
      previewSrc={(s) => `/preview/${s}`}
      onExit={() => {}}
      onReload={() => {}}
      device="desktop"
      onDevice={() => {}}
      dark={false}
      onToggleTheme={() => {}}
    />
  );
  const frame = container.querySelector("iframe")!;
  const rects = [
    { index: 0, top: 0, left: 0, width: 800, height: 300 },
    { index: 1, top: 300, left: 0, width: 800, height: 200 },
  ];
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, type: "rects", rects }, source: frame.contentWindow, origin: "null" }));
  });
}

const heart = () => within(screen.getByRole("toolbar", { name: "Section" })).getByRole("button", { name: "Save to Sections" });

describe("PageEditor Save to Sections", () => {
  it("saves the slice under its label and says so", async () => {
    const save = vi.fn(async () => ({ id: "x", name: "Intro", savedAt: "", slice: page.slices[0]! }));
    mount(save);
    await userEvent.setup().click(heart());
    expect(save).toHaveBeenCalledWith("Intro", page.slices[0]);
    expect((await screen.findAllByText("Saved to Sections"))[0]).toBeTruthy();
  });

  it("reports a failed save", async () => {
    mount(vi.fn(async () => Promise.reject(new Error("disk full"))));
    await userEvent.setup().click(heart());
    expect((await screen.findAllByText("Save to Sections failed: disk full"))[0]).toBeTruthy();
  });
});
