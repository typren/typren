import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { CANVAS_PROTOCOL, CanvasUnavailable, createCanvas, createCanvasSession, readNonce, type RendererAdapter } from "./canvas";
import { createReactRenderer } from "./canvas-react";

const STUDIO = "http://127.0.0.1:4321";
const NONCE = "n0nce-n0nce-n0nce-1";

/** A renderer that writes `heading` into the element and counts its calls. */
function fakeRenderer() {
  const calls = { mount: 0, update: 0, unmount: 0 };
  const renderer: RendererAdapter<string> = {
    name: "fake",
    mount(el, tag, props) {
      calls.mount++;
      el.textContent = `${tag}:${String(props.heading)}`;
      return {
        update: (p) => {
          calls.update++;
          el.textContent = `${tag}:${String(p.heading)}`;
        },
        unmount: () => {
          calls.unmount++;
          el.textContent = "";
        },
      };
    },
  };
  return { renderer, calls };
}

const hero = (heading: string) => ({ slice: "hero", heading });
const doc = (rev: number, slices: [string, unknown][]) => ({ type: "document", rev, slices: slices.map(([key, slice]) => ({ key, slice })) });

function session(renderer = fakeRenderer()) {
  const root = document.createElement("div");
  const post = vi.fn();
  const s = createCanvasSession({ renderer: renderer.renderer, registry: { hero: "H", prose: "P" }, root, post });
  const shown = () => Array.from(root.children, (el) => [el.getAttribute("data-typren-index"), el.getAttribute("data-typren-key"), el.textContent]);
  const sent = (type: string) => post.mock.calls.map(([m]) => m).filter((m) => m.type === type);
  return { ...s, root, post, shown, sent, calls: renderer.calls };
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => (cb(0), 1));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("createCanvasSession", () => {
  it("says hello with its protocol and renderer", () => {
    const s = session();
    s.hello();
    expect(s.post).toHaveBeenCalledWith({ type: "hello", protocol: CANVAS_PROTOCOL, renderers: ["fake"], server: false });
  });

  it("renders a document in order, wrapped for the bridge, and reports the slices it cannot render", () => {
    const s = session();
    s.receive(doc(1, [["a", hero("One")], ["b", { slice: "nope" }], ["c", hero("Two")]]));
    expect(s.shown()).toEqual([
      ["0", "a", "H:One"],
      ["1", "b", ""],
      ["2", "c", "H:Two"],
    ]);
    expect(s.sent("missing")).toEqual([{ type: "missing", keys: ["b"] }]);
    expect(s.sent("rendered")).toEqual([{ type: "rendered", rev: 1, ms: expect.any(Number) }]);
  });

  it("ignores messages without a revision, of other types, or with a malformed document", () => {
    const s = session();
    s.receive({ type: "document", slices: [] });
    s.receive({ type: "other", rev: 1 });
    s.receive({ type: "document", rev: 1, slices: "nope" });
    expect(s.post).not.toHaveBeenCalled();
  });

  it("applies a patch to its base revision without remounting what stays", () => {
    const s = session();
    s.receive(doc(1, [["a", hero("A")], ["b", hero("B")], ["c", hero("C")]]));
    expect(s.calls.mount).toBe(3);
    s.receive({
      type: "patch",
      rev: 2,
      base: 1,
      ops: [
        { op: "move", key: "c", to: 0 },
        { op: "set", key: "a", slice: hero("A2") },
        { op: "remove", key: "b" },
        { op: "insert", at: 1, key: "d", slice: { slice: "prose", heading: "D" } },
      ],
    });
    expect(s.shown()).toEqual([
      ["0", "c", "H:C"],
      ["1", "d", "P:D"],
      ["2", "a", "H:A2"],
    ]);
    expect(s.calls).toEqual({ mount: 4, update: 1, unmount: 1 });
    expect(s.sent("rendered").at(-1)).toMatchObject({ rev: 2 });
  });

  it("remounts a slot whose slice type changes, and keeps a document's same keys mounted", () => {
    const s = session();
    s.receive(doc(1, [["a", hero("A")]]));
    s.receive({ type: "patch", rev: 2, base: 1, ops: [{ op: "set", key: "a", slice: { slice: "prose", heading: "A" } }] });
    expect(s.shown()).toEqual([["0", "a", "P:A"]]);
    expect(s.calls).toMatchObject({ mount: 2, unmount: 1 });
    s.receive(doc(3, [["a", { slice: "prose", heading: "B" }]]));
    expect(s.calls).toMatchObject({ mount: 2, update: 1 });
  });

  it.each([
    ["a stale base", { base: 0, ops: [] }],
    ["no base", { ops: [] }],
    ["ops that are not a list", { base: 1, ops: {} }],
    ["a null op", { base: 1, ops: [null] }],
    ["an unknown op", { base: 1, ops: [{ op: "swap", key: "a" }] }],
    ["a missing key", { base: 1, ops: [{ op: "set", key: "zz", slice: hero("x") }] }],
    ["a duplicate insert", { base: 1, ops: [{ op: "insert", at: 0, key: "a", slice: hero("x") }] }],
    ["an out-of-range insert", { base: 1, ops: [{ op: "insert", at: 5, key: "z", slice: hero("x") }] }],
    ["an out-of-range move", { base: 1, ops: [{ op: "move", key: "a", to: -1 }] }],
    ["a duplicate key in one patch", { base: 1, ops: [{ op: "set", key: "a", slice: hero("x") }, { op: "set", key: "a", slice: hero("y") }] }],
  ])("asks for the whole document on %s, changing nothing", (_n, patch) => {
    const s = session();
    s.receive(doc(1, [["a", hero("A")]]));
    s.receive({ type: "patch", rev: 2, ...patch });
    expect(s.sent("resync")).toEqual([{ type: "resync", rev: 1 }]);
    expect(s.shown()).toEqual([["0", "a", "H:A"]]);
  });

  it("asks for a document when a patch arrives before any", () => {
    const s = session();
    s.receive({ type: "patch", rev: 1, base: 0, ops: [] });
    expect(s.sent("resync")).toEqual([{ type: "resync", rev: null }]);
  });

  it("reports a section that throws, by key, and unmounts everything on destroy", () => {
    const s = session();
    s.receive(doc(1, [["a", hero("A")]]));
    s.root.querySelector('[data-typren-key="a"]')!.appendChild(document.createElement("span")).dispatchEvent(new CustomEvent("typren:error", { bubbles: true }));
    s.root.dispatchEvent(new CustomEvent("typren:error"));
    expect(s.sent("error")).toEqual([{ type: "error", key: "a" }]);
    s.destroy();
    expect(s.calls.unmount).toBe(1);
  });
});

describe("readNonce", () => {
  it("reads only a plausible nonce from the fragment", () => {
    expect(readNonce(`#typren=${NONCE}`)).toBe(NONCE);
    expect(readNonce("#typren=short")).toBeNull();
    expect(readNonce("#typren=<script>alert(1)</script>xx")).toBeNull();
    expect(readNonce("")).toBeNull();
  });
});

describe("createCanvas page mode", () => {
  let posted: ReturnType<typeof vi.spyOn>;
  const sent = (type: string) => posted.mock.calls.filter(([m]: unknown[]) => (m as { type?: string }).type === type);
  const send = (data: unknown, { origin = STUDIO, source = window as MessageEventSource | null } = {}) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
      await Promise.resolve();
    });
  const signed = (m: object) => ({ __typren: true, nonce: NONCE, ...m });
  const mounts = vi.fn();
  function Hero({ heading }: { heading: string }) {
    // Once per mount, by design: the count is the assertion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => void mounts(heading), []);
    return <h2>{heading}</h2>;
  }
  function Boom(): never {
    throw new Error("boom");
  }
  const Canvas = createCanvas({ renderer: createReactRenderer(), registry: { hero: Hero, boom: Boom } as unknown as Record<string, React.ComponentType<Record<string, unknown>>> });
  const headings = () => Array.from(document.querySelectorAll("[data-typren-canvas] h2"), (h) => h.textContent);

  beforeEach(() => {
    posted = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    mounts.mockClear();
    window.history.replaceState(null, "", `/typren/section?page#typren=${NONCE}`);
  });

  it("says hello signed with the nonce, renders posted documents and keeps instances across a move", async () => {
    render(<Canvas origin={STUDIO} />);
    await waitFor(() => expect(sent("hello")).toHaveLength(1));
    expect(sent("hello")[0]).toEqual([{ __typren: true, type: "hello", protocol: 1, renderers: ["react"], server: false, nonce: NONCE }, STUDIO]);
    await send(signed(doc(1, [["a", hero("A")], ["b", hero("B")]])));
    expect(headings()).toEqual(["A", "B"]);
    await send(signed({ type: "patch", rev: 2, base: 1, ops: [{ op: "move", key: "b", to: 0 }, { op: "set", key: "a", slice: hero("A2") }] }));
    expect(headings()).toEqual(["B", "A2"]);
    expect(mounts.mock.calls).toEqual([["A"], ["B"]]);
    expect(sent("rendered").at(-1)![0]).toMatchObject({ rev: 2, nonce: NONCE });
  });

  it("ignores messages without the nonce, from another origin or from another window", async () => {
    render(<Canvas origin={STUDIO} />);
    await waitFor(() => expect(sent("hello")).toHaveLength(1));
    await send({ __typren: true, ...doc(1, [["a", hero("A")]]) });
    await send({ ...signed(doc(1, [["a", hero("A")]])), nonce: "n0nce-n0nce-n0nce-2" });
    await send(signed(doc(1, [["a", hero("A")]])), { origin: "http://evil.test" });
    await send(signed(doc(1, [["a", hero("A")]])), { source: null });
    await send({ ...doc(1, [["a", hero("A")]]), nonce: NONCE });
    expect(headings()).toEqual([]);
  });

  it("isolates a section that throws and reports it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Canvas origin={STUDIO} />);
    await waitFor(() => expect(sent("hello")).toHaveLength(1));
    await send(signed(doc(1, [["a", hero("A")], ["x", { slice: "boom" }]])));
    expect(headings()).toEqual(["A"]);
    expect(sent("error")[0]![0]).toMatchObject({ type: "error", key: "x" });
    // New props try it again.
    await send(signed({ type: "patch", rev: 2, base: 1, ops: [{ op: "set", key: "x", slice: { slice: "boom", n: 2 } }] }));
    expect(sent("error")).toHaveLength(2);
  });

  it("stays inert without a nonce, a valid origin, or outside development", async () => {
    window.history.replaceState(null, "", "/typren/section?page");
    render(<Canvas origin={STUDIO} />);
    window.history.replaceState(null, "", `/typren/section?page#typren=${NONCE}`);
    render(<Canvas origin="*" />);
    render(<Canvas />);
    vi.stubEnv("NODE_ENV", "production");
    render(<Canvas origin={STUDIO} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).not.toHaveBeenCalled();
    expect(document.querySelector("[data-typren-canvas]")).toBeNull();
  });
});

describe("CanvasUnavailable", () => {
  it("tells the studio at once that there is no client renderer, and only with a nonce and origin", () => {
    const posted = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    window.history.replaceState(null, "", "/typren/section?page");
    render(<CanvasUnavailable origin={STUDIO} />);
    expect(posted).not.toHaveBeenCalled();
    window.history.replaceState(null, "", `/typren/section?page#typren=${NONCE}`);
    render(<CanvasUnavailable />);
    expect(posted).not.toHaveBeenCalled();
    render(<CanvasUnavailable origin={STUDIO} />);
    expect(posted).toHaveBeenCalledWith({ __typren: true, type: "hello", protocol: 1, renderers: [], server: false, nonce: NONCE }, STUDIO);
  });
});
