import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageActions, PageFlows, PageContent } from "@typren/core";
import { useRef, useState } from "react";
import { DevicePreview, type Device } from "./device-preview";
import { Frame } from "./frame";
import { usePageEditor } from "./page-editor";
import type { TyprenStudioHost } from "./types";
import type { LocaleSwitch } from "./locale-select";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Runs autosave's 0.8s debounce and the write it starts. */
const autosave = () => act(async () => void (await vi.advanceTimersByTimeAsync(800)));

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

const answer = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

const actions = {
  createPage: vi.fn(async (title: string) => title),
  deletePage: vi.fn(async () => {}),
  saveDraft: vi.fn(async () => ({ ok: true as const, version: "v2" })),
  publish: vi.fn(async () => ({ ok: true as const, version: "v2" })),
  commitPage: vi.fn(async () => ({ ok: true as const, version: "v2" })),
  publishAll: vi.fn(async () => [] as string[]),
  discardDraft: vi.fn(async () => {}),
} as unknown as PageActions & PageFlows;

const host: TyprenStudioHost = { actions, sliceNames: ["hero"], defaults: {}, previewPath: "/preview" };
const page: PageContent = {
  meta: {},
  slices: [
    { slice: "hero", label: "Intro", title: "Old copy" },
    { slice: "hero", label: "Outro", title: "Bye" },
  ],
  body: "",
};

function mount(
  onExit = vi.fn(),
  extra: { hasDraft?: boolean; otherDrafts?: { slug: string; title: string }[]; localeSwitch?: LocaleSwitch } = {}
) {
  const { container } = render(
    <PageEditor
      host={host}
      slug="home"
      pill={{ title: "Home", url: "/", hasDraft: extra.hasDraft ?? false }}
      otherDrafts={extra.otherDrafts}
      initialPage={page}
      initialVersion="v1"
      previewSrc={(s, v) => `/preview/${s}?v=${v}`}
      onExit={onExit}
      onReload={() => {}}
      device="desktop"
      onDevice={() => {}}
      dark={false}
      onToggleTheme={() => {}}
      localeSwitch={extra.localeSwitch}
    />
  );
  return { frame: container.querySelector("iframe")!, onExit };
}

const rects = {
  __typren: true,
  type: "rects",
  rects: [
    { index: 0, top: 0, left: 0, width: 800, height: 300 },
    { index: 1, top: 300, left: 0, width: 800, height: 200 },
  ],
};
const edit = { __typren: true, type: "edit", index: 0, before: "Old copy", after: "Injected" };
const post = (data: unknown, source: MessageEventSource | null, origin: string) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
  });

describe("PageEditor preview isolation", () => {
  it("sandboxes the preview frame without allow-same-origin", () => {
    const tokens = (mount().frame.getAttribute("sandbox") ?? "").split(/\s+/);
    expect(tokens).toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
  });

  it("lets a cross-origin preview keep its own origin so the site's dev assets load", () => {
    const { container } = render(
      <PageEditor
        host={host}
        slug="home"
        pill={{ title: "Home", url: "/", hasDraft: false }}
        initialPage={page}
        initialVersion="v1"
        previewSrc={() => "http://127.0.0.1:4401/"}
        onExit={vi.fn()}
        onReload={() => {}}
        device="desktop"
        onDevice={() => {}}
        dark={false}
        onToggleTheme={() => {}}
      />
    );
    expect(container.querySelector("iframe")!.getAttribute("sandbox")).toContain("allow-same-origin");
  });

  it("applies an edit sent by its own preview frame, whose sandboxed origin is opaque", () => {
    const { frame } = mount();
    post(edit, frame.contentWindow, "null");
    expect(screen.getAllByText("Saving…")[0]).toBeTruthy();
  });

  it("ignores a same-origin edit from any window other than the preview frame", () => {
    mount();
    post(edit, window, window.location.origin);
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("ignores a frame message whose index is not an integer", () => {
    const { frame } = mount();
    post({ ...edit, index: 0.5 }, frame.contentWindow, "null");
    expect(screen.queryByText("Saving…")).toBeNull();
  });
});

describe("PageEditor", () => {
  it("opens the field form from the rail once the frame has posted its geometry", async () => {
    const user = userEvent.setup();
    const { frame } = mount();
    post(rects, frame.contentWindow, "null");
    expect(screen.queryByDisplayValue("Old copy")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Intro/ }));
    expect(await screen.findByDisplayValue("Old copy")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Old copy")).toBeNull());
  });

  it("a frame select moves the overlay without opening the form", () => {
    const { frame } = mount();
    post(rects, frame.contentWindow, "null");
    post({ __typren: true, type: "select", index: 0 }, frame.contentWindow, "null");
    expect(screen.getByRole("toolbar", { name: "Section" })).toBeTruthy();
    expect(screen.queryByDisplayValue("Old copy")).toBeNull();
  });

  it("leaves edit mode without asking when nothing is unsaved", async () => {
    const { onExit } = mount();
    await userEvent.setup().click(screen.getByRole("button", { name: "Pages" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onExit).toHaveBeenCalled();
  });

  it("saves unsaved edits before leaving, and asks only when that save fails", async () => {
    vi.mocked(actions.saveDraft).mockClear();
    const { frame, onExit } = mount();
    post(edit, frame.contentWindow, "null");
    await userEvent.setup().click(screen.getByRole("button", { name: "Pages" }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(actions.saveDraft).toHaveBeenCalledWith("home", expect.objectContaining({ slices: expect.any(Array) }), "v1", undefined);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before leaving when that save fails, and stays when declined", async () => {
    // Every write fails here, the autosave's too, however the timers fall.
    vi.mocked(actions.saveDraft).mockRejectedValue(new Error("offline"));
    const second = mount();
    post(edit, second.frame.contentWindow, "null");
    await userEvent.setup().click(screen.getByRole("button", { name: "Pages" }));
    await answer("Cancel");
    expect(second.onExit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Not saved")[0]).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Pages" }));
    await answer("Leave");
    await waitFor(() => expect(second.onExit).toHaveBeenCalled());
    vi.mocked(actions.saveDraft).mockImplementation(async () => ({ ok: true as const, version: "v2" }));
  });

  it("waits out a save in flight before leaving, never dropping it", async () => {
    let finish: (v: { ok: true; version: string }) => void = () => {};
    vi.mocked(actions.saveDraft).mockImplementationOnce(() => new Promise((r) => (finish = r)) as never);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { frame, onExit } = mount();
    post(edit, frame.contentWindow, "null");
    await act(async () => void (await vi.advanceTimersByTimeAsync(900)));
    act(() => screen.getByRole("button", { name: "Pages" }).click());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    expect(onExit).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, version: "v2" }));
    vi.useRealTimers();
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });
  it("saves before a locale switch, and asks only when that save fails", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { frame } = mount(vi.fn(), { localeSwitch: { value: "en", locales: ["en", "fr"], onChange } });
    const pick = async () => {
      await user.click(screen.getAllByRole("combobox", { name: "Preview locale" })[0]!);
      await user.click(await screen.findByRole("option", { name: "fr" }));
    };
    post(edit, frame.contentWindow, "null");
    await pick();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("fr"));
    vi.mocked(actions.saveDraft).mockRejectedValue(new Error("offline"));
    post({ ...edit, before: "Injected", after: "Again" }, document.querySelector("iframe")!.contentWindow, "null");
    await pick();
    await answer("Cancel");
    expect(onChange).toHaveBeenCalledOnce();
    vi.mocked(actions.saveDraft).mockImplementation(async () => ({ ok: true as const, version: "v2" }));
  });
  it("autosaves at the loaded version and says when", async () => {
    vi.mocked(actions.saveDraft).mockClear();
    vi.useFakeTimers();
    const { frame } = mount();
    post(edit, frame.contentWindow, "null");
    expect(screen.getAllByText("Saving…")[0]).toBeTruthy();
    await autosave();
    expect(actions.saveDraft).toHaveBeenCalledWith("home", expect.anything(), "v1", undefined);
    expect(screen.getAllByText("Saved just now")[0]).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("PageEditor canvas overlay", () => {
  const rail = () => screen.getByRole("navigation", { name: "Studio" });
  const rows = () => within(rail()).getAllByRole("listitem").map((li) => li.textContent);
  const toolbar = () => screen.getByRole("toolbar", { name: "Section" });

  it("draws nothing until its own frame posts rects, and ignores rects from any other window", () => {
    const { frame } = mount();
    expect(screen.queryByRole("toolbar")).toBeNull();
    post(rects, window, window.location.origin);
    expect(screen.queryByRole("toolbar")).toBeNull();
    post({ ...rects, rects: "nope" }, frame.contentWindow, "null");
    expect(screen.queryByRole("toolbar")).toBeNull();
    post(rects, frame.contentWindow, "null");
    expect(toolbar()).toBeTruthy();
  });

  it("follows the hovered slice and ignores a malformed hover", () => {
    const { frame } = mount();
    post(rects, frame.contentWindow, "null");
    post({ __typren: true, type: "hover", index: 1 }, frame.contentWindow, "null");
    expect(toolbar().style.top).toBe("calc(max(300px, var(--scroll-y, 0px)) + 8px)");
    post({ __typren: true, type: "hover", index: "0" }, frame.contentWindow, "null");
    expect(toolbar().style.top).toBe("calc(max(300px, var(--scroll-y, 0px)) + 8px)");
    post({ __typren: true, type: "hover", index: null }, frame.contentWindow, "null");
    expect(toolbar().style.top).toBe("calc(max(0px, var(--scroll-y, 0px)) + 8px)");
  });

  it("places the controls in page coordinates and has the bridge draw the outlines", () => {
    const { frame } = mount();
    const sent = vi.spyOn(frame.contentWindow!, "postMessage");
    post({ ...rects, scrollX: 0, scrollY: 120 }, frame.contentWindow, "null");
    post({ __typren: true, type: "hover", index: 1 }, frame.contentWindow, "null");
    expect(toolbar().style.top).toBe("calc(max(420px, var(--scroll-y, 0px)) + 8px)");
    expect(screen.queryByTestId("outline-1")).toBeNull();
    expect(sent).toHaveBeenLastCalledWith(
      expect.objectContaining({ __typren: true, type: "outline", active: 1, selected: 0 }),
      "*"
    );
  });

  it("duplicates, moves and adds through the same actions the rail list uses", async () => {
    const user = userEvent.setup();
    const { frame } = mount();
    post(rects, frame.contentWindow, "null");
    await user.click(within(toolbar()).getByRole("button", { name: "Move down" }));
    expect(rows()[0]).toContain("Outro");
    await user.click(screen.getByRole("combobox", { name: "Add section above" }));
    await user.click(await screen.findByRole("option", { name: "hero" }));
    expect(rows()[1]).toMatch(/^hero/);
    expect(rows()[2]).toContain("Intro");
    await user.click(within(toolbar()).getByRole("button", { name: "Duplicate" }));
    expect(rows()).toHaveLength(4);
    expect(screen.getAllByText("Unpublished changes")[0]).toBeTruthy();
  });

  it("removes a slice only after the confirm", async () => {
    const user = userEvent.setup();
    const { frame } = mount();
    post(rects, frame.contentWindow, "null");
    await user.click(within(toolbar()).getByRole("button", { name: "Remove" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(rows()).toHaveLength(2);
    await user.click(within(toolbar()).getByRole("button", { name: "Remove" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Outro");
  });

  it("Edit section opens the hovered slice's form; layers focuses its rail row", async () => {
    const user = userEvent.setup();
    const { frame } = mount();
    post(rects, frame.contentWindow, "null");
    post({ __typren: true, type: "hover", index: 1 }, frame.contentWindow, "null");
    await user.click(screen.getByRole("button", { name: "Show in sections list" }));
    expect(document.activeElement?.textContent).toContain("Outro");
    post({ __typren: true, type: "hover", index: 1 }, frame.contentWindow, "null");
    await user.click(within(toolbar()).getByRole("button", { name: "Edit section" }));
    expect(await screen.findByDisplayValue("Bye")).toBeTruthy();
  });
});

describe("PageEditor lifecycle", () => {
  const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

  it("has no Save button, and no Discard or Publish until there is something to act on", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.getAllByText("Up to date")[0]).toBeTruthy();
  });
  it("offers Discard and Publish after an edit", () => {
    const { frame } = mount();
    post(edit, frame.contentWindow, "null");
    expect(btn("Discard").disabled).toBe(false);
    expect(btn("Publish").disabled).toBe(false);
  });
  it("Discard asks first, and only drops the draft on confirm", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    vi.mocked(actions.discardDraft).mockClear();
    mount(onExit, { hasDraft: true });
    await user.click(btn("Discard"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(actions.discardDraft).not.toHaveBeenCalled();
    await user.click(btn("Discard"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(actions.discardDraft).toHaveBeenCalledWith("home", undefined);
  });

  it("Discard of unsaved edits with no draft just leaves", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    vi.mocked(actions.discardDraft).mockClear();
    const { frame } = mount(onExit);
    post(edit, frame.contentWindow, "null");
    await user.click(btn("Discard"));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(actions.discardDraft).not.toHaveBeenCalled();
  });

  it("Publish lists every page with pending changes, and Cancel publishes nothing", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.commitPage).mockClear();
    vi.mocked(actions.publishAll).mockClear();
    const { frame } = mount(vi.fn(), { otherDrafts: [{ slug: "about", title: "About" }] });
    post(edit, frame.contentWindow, "null");
    await user.click(btn("Publish"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Home")).toBeTruthy();
    expect(within(dialog).getByText("Unsaved edits")).toBeTruthy();
    expect(within(dialog).getByText("About")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(actions.commitPage).not.toHaveBeenCalled();
    expect(actions.publishAll).not.toHaveBeenCalled();
  });

  it("confirming saves this page, then publishes it and the other drafts", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    vi.mocked(actions.commitPage).mockClear();
    vi.mocked(actions.publishAll).mockClear();
    const { container } = render(
      <PageEditor
        host={host}
        slug="home"
        pill={{ title: "Home", url: "/", hasDraft: true }}
        otherDrafts={[{ slug: "about", title: "About" }]}
        initialPage={page}
        initialVersion="v1"
        previewSrc={() => "/p"}
        onExit={() => {}}
        onReload={onReload}
        device="desktop"
        onDevice={() => {}}
        dark={false}
        onToggleTheme={() => {}}
      />
    );
    expect(container).toBeTruthy();
    await user.click(btn("Publish"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(actions.commitPage).toHaveBeenCalledWith("home", undefined, "v1", undefined);
    expect(actions.publishAll).toHaveBeenCalledWith(undefined);
  });

  it("sends unsaved edits with the publish, so a lost race stops before the other pages", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.commitPage).mockClear();
    vi.mocked(actions.publishAll).mockClear();
    vi.mocked(actions.commitPage).mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: "v9" });
    const { frame } = mount(vi.fn(), { otherDrafts: [{ slug: "about", title: "About" }] });
    post(edit, frame.contentWindow, "null");
    await user.click(btn("Publish"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(actions.commitPage).toHaveBeenCalledWith("home", expect.objectContaining({ slices: expect.any(Array) }), "v1", undefined);
    expect(actions.publishAll).not.toHaveBeenCalled();
  });

  it("publishes only the other drafts when this page has none", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.commitPage).mockClear();
    vi.mocked(actions.publishAll).mockClear();
    const onReload = vi.fn();
    render(
      <PageEditor
        host={host}
        slug="home"
        pill={{ title: "Home", url: "/", hasDraft: false }}
        otherDrafts={[{ slug: "about", title: "About" }]}
        initialPage={page}
        initialVersion="v1"
        previewSrc={() => "/p"}
        onExit={() => {}}
        onReload={onReload}
        device="desktop"
        onDevice={() => {}}
        dark={false}
        onToggleTheme={() => {}}
      />
    );
    await user.click(btn("Publish"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(actions.commitPage).not.toHaveBeenCalled();
    expect(actions.publishAll).toHaveBeenCalled();
  });

  it("shows the conflict banner when the publish loses a version race", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.commitPage).mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: "v9" });
    mount(vi.fn(), { hasDraft: true });
    await user.click(btn("Publish"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("reports a publish failure", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.commitPage).mockRejectedValueOnce(new Error("boom"));
    mount(vi.fn(), { hasDraft: true });
    await user.click(btn("Publish"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    expect((await screen.findAllByText("Publish failed: boom"))[0]).toBeTruthy();
  });
});

describe("PageEditor local git lifecycle", () => {
  const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
  const ahead = {
    branch: "main",
    upstream: "origin/main",
    commits: [{ hash: "abc1234", subject: "content: update home", files: ["content/home.md"] }],
  };
  const waiting = [{ path: "content/home.md", change: "modified" as const, commits: [{ hash: "abc1234", subject: "content: update home" }] }];
  const git = {
    outgoing: vi.fn(async () => ahead),
    pending: vi.fn(async () => waiting),
    push: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    history: vi.fn(async () => [{ hash: "abc1234", subject: "content: update home", author: "Ada", date: new Date(Date.now() - 3.5 * 3_600_000).toISOString() }]),
  };
  const onReview = vi.fn();

  function mountLocal(hasDraft = false, gitRev = 0) {
    vi.mocked(actions.saveDraft).mockClear();
    vi.mocked(actions.publish).mockClear();
    git.outgoing.mockClear();
    git.pending.mockClear();
    onReview.mockClear();
    const { container, rerender } = render(<Local hasDraft={hasDraft} gitRev={gitRev} />);
    return Object.assign(container.querySelector("iframe")!, { rerender });
  }
  function Local({ hasDraft, gitRev }: { hasDraft: boolean; gitRev: number }) {
    return (
      <PageEditor
        host={{ ...host, git }}
        onReview={onReview}
        gitRev={gitRev}
        slug="home"
        pill={{ title: "Home", url: "/", hasDraft }}
        initialPage={page}
        initialVersion="v1"
        previewSrc={() => "/p"}
        onExit={() => {}}
        onReload={() => {}}
        device="desktop"
        onDevice={() => {}}
        dark={false}
        onToggleTheme={() => {}}
      />
    );
  }

  it("autosaves the draft about 0.8s after an edit", async () => {
    vi.useFakeTimers();
    const frame = mountLocal();
    post(edit, frame.contentWindow, "null");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(actions.saveDraft).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    vi.useRealTimers();
    expect(actions.saveDraft).toHaveBeenCalledWith("home", expect.anything(), "v1", undefined);
    expect(actions.publish).not.toHaveBeenCalled();
    expect(screen.getAllByText("Saved just now")[0]).toBeTruthy();
  });

  const reviewReason = () => screen.getByLabelText(/^Review: /).getAttribute("aria-label");

  it("keeps Review disabled, with the reason, until a draft is saved", async () => {
    git.pending.mockResolvedValueOnce([]);
    const frame = mountLocal();
    await waitFor(() => expect(git.pending).toHaveBeenCalled());
    expect(btn("Review").disabled).toBe(true);
    expect(reviewReason()).toContain("Nothing to review yet");
    // Review leads; the save status sits at the bar's edge after it.
    expect(btn("Review").compareDocumentPosition(screen.getByRole("button", { name: /Version history/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    post(edit, frame.contentWindow, "null");
    await waitFor(() => expect(btn("Review").disabled).toBe(false));
  });

  it("Review saves the latest edits first, then opens the shell's panel", async () => {
    const frame = mountLocal();
    post(edit, frame.contentWindow, "null");
    await userEvent.setup().click(btn("Review"));
    expect(actions.saveDraft).toHaveBeenCalledWith("home", expect.anything(), "v1", undefined);
    expect(actions.publish).not.toHaveBeenCalled();
    expect(onReview).toHaveBeenCalled();
    expect(vi.mocked(actions.saveDraft).mock.invocationCallOrder[0]).toBeLessThan(onReview.mock.invocationCallOrder[0]!);
  });

  it("never reads Saved after a lost race or a failed write", async () => {
    vi.mocked(actions.saveDraft).mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: "v9" } as never);
    vi.useFakeTimers();
    let frame = mountLocal();
    post(edit, frame.contentWindow, "null");
    await autosave();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getAllByText("Not saved: changed elsewhere")[0]).toBeTruthy();
    cleanup();
    vi.mocked(actions.saveDraft).mockReset().mockRejectedValueOnce(new Error("Someone's hook said no")).mockResolvedValue({ ok: true, version: "v2" } as never);
    frame = mountLocal();
    post(edit, frame.contentWindow, "null");
    await autosave();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't save your changes");
    expect(alert.textContent).toContain("Someone's hook said no");
    expect(screen.getAllByText("Not saved")[0]).toBeTruthy();
    expect(screen.queryByText(/^Saved/)).toBeNull();
  });

  it("fetches what is pending again when the Review panel acted, and disables Review once nothing is", async () => {
    const frame = mountLocal();
    await waitFor(() => expect(btn("Review").disabled).toBe(false));
    git.pending.mockResolvedValueOnce([]);
    frame.rerender(<Local hasDraft={false} gitRev={1} />);
    await waitFor(() => expect(git.pending).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(btn("Review").disabled).toBe(true));
  });

  it("enables Review for a draft on this page or another", async () => {
    git.pending.mockResolvedValueOnce([]);
    mountLocal(true);
    await waitFor(() => expect(git.pending).toHaveBeenCalled());
    expect(btn("Review").disabled).toBe(false);
  });

  it("offers Review when the branch has no upstream, so the panel can say so", async () => {
    git.outgoing.mockResolvedValue({ branch: "wip", upstream: null, commits: [] } as never);
    mountLocal();
    await waitFor(() => expect(btn("Review").disabled).toBe(false));
    git.outgoing.mockResolvedValue(ahead);
  });

  it("disables Review up front, with the reason, on a detached HEAD", async () => {
    git.outgoing.mockResolvedValue({ ...ahead, branch: "" });
    mountLocal();
    expect((await screen.findByRole("alert")).textContent).toContain("Check out a branch in your site folder to save.");
    expect(btn("Review").disabled).toBe(true);
    expect(reviewReason()).toContain("Check out a branch");
    git.outgoing.mockResolvedValue(ahead);
  });

  it("disables Review when what is pending can't be read", async () => {
    git.pending.mockRejectedValueOnce(new Error("offline"));
    git.outgoing.mockRejectedValueOnce(new Error("offline"));
    mountLocal();
    await waitFor(() => expect(git.pending).toHaveBeenCalled());
    await waitFor(() => expect(btn("Review").disabled).toBe(true));
  });

  it("opens the page's version history from the save status on focus, under its unpushed draft", async () => {
    mountLocal(true);
    const status = screen.getByRole("button", { name: /Version history/ });
    act(() => status.focus());
    const list = await screen.findByRole("list", { name: "Version history" });
    expect(git.history).toHaveBeenCalledWith("home", undefined);
    expect(within(list).getAllByRole("listitem")[0]!.textContent).toBe("DraftNot pushed yet");
    expect(list.textContent).toContain("content: update home");
    expect(list.textContent).toMatch(/Ada · 3 hr\.? agoabc1234/);
  });

});
