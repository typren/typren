import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initPreviewBridge } from "./preview-bridge.vanilla";

let cleanup: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = '<div data-typren-index="0">block</div>';
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
});

describe("initPreviewBridge origin handshake", () => {
  it("defaults to window.location.origin when no allowedOrigin is given (same-origin local setups unchanged)", () => {
    cleanup = initPreviewBridge();
    const postMessage = vi.spyOn(window.parent, "postMessage");

    document.querySelector("[data-typren-index]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][1]).toBe(window.location.origin);
  });

  it("posts to the explicit allowedOrigin when the host provides one, never '*'", () => {
    const hostOrigin = "https://dashboard.typren.example";
    cleanup = initPreviewBridge(hostOrigin);
    const postMessage = vi.spyOn(window.parent, "postMessage");

    document.querySelector("[data-typren-index]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    const targetOrigin = postMessage.mock.calls[0][1];
    expect(targetOrigin).toBe(hostOrigin);
    expect(targetOrigin).not.toBe("*");
  });

  it("accepts an inbound message only from the configured allowedOrigin", () => {
    const hostOrigin = "https://dashboard.typren.example";
    cleanup = initPreviewBridge(hostOrigin);

    window.dispatchEvent(
      new MessageEvent("message", { data: { __typren: true, type: "theme", theme: "dark" }, origin: "https://evil.example" })
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    window.dispatchEvent(
      new MessageEvent("message", { data: { __typren: true, type: "theme", theme: "dark" }, origin: hostOrigin })
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("with a session nonce, signs every post and ignores messages without it", () => {
    const hostOrigin = "https://dashboard.typren.example";
    cleanup = initPreviewBridge(hostOrigin, "n0nce-n0nce-n0nce-1");
    const postMessage = vi.spyOn(window.parent, "postMessage");
    document.querySelector("[data-typren-index]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(postMessage.mock.calls[0]![0]).toMatchObject({ type: "select", nonce: "n0nce-n0nce-n0nce-1" });
    const theme = (extra: object) =>
      window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, type: "theme", theme: "dark", ...extra }, origin: hostOrigin }));
    theme({});
    theme({ nonce: "other-other-other-1" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    theme({ nonce: "n0nce-n0nce-n0nce-1" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("rejects messages from the page's own origin once a different allowedOrigin is configured", () => {
    const hostOrigin = "https://dashboard.typren.example";
    cleanup = initPreviewBridge(hostOrigin);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __typren: true, type: "theme", theme: "dark" },
        origin: window.location.origin,
      })
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it.each(["*", "null", "", "http://127.0.0.1:4400/", "javascript:alert(1)", "not a url"])(
    "stays inert for an allowedOrigin that is not an http(s) origin: %j",
    (bad) => {
      const postMessage = vi.spyOn(window.parent, "postMessage");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      cleanup = initPreviewBridge(bad);

      document.querySelector("[data-typren-index]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      window.dispatchEvent(
        new MessageEvent("message", { data: { __typren: true, type: "theme", theme: "dark" }, origin: bad })
      );

      expect(postMessage).not.toHaveBeenCalled();
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(warn).toHaveBeenCalledOnce();
    }
  );
});

describe("initPreviewBridge overlay geometry", () => {
  const sent = (spy: { mock: { calls: unknown[][] } }, type: string) =>
    spy.mock.calls.map((c) => c[0] as { type: string }).filter((m) => m.type === type);

  it("posts one coalesced rects message per frame with every block's viewport rect and the scroll", async () => {
    document.body.innerHTML = '<div data-typren-index="0">a</div><div data-typren-index="1">b</div>';
    vi.spyOn(document.body.children[1], "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 200, width: 300, height: 120 })
    );
    const postMessage = vi.spyOn(window.parent, "postMessage");
    cleanup = initPreviewBridge("https://dashboard.typren.example");
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));

    await new Promise((r) => requestAnimationFrame(r));
    const rects = sent(postMessage, "rects");
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({
      __typren: true,
      type: "rects",
      rects: [
        { index: 0, top: 0, left: 0, width: 0, height: 0 },
        { index: 1, top: 200, left: 10, width: 300, height: 120 },
      ],
      scrollX: 0,
      scrollY: 0,
    });
    expect(postMessage.mock.calls[0][1]).toBe("https://dashboard.typren.example");
  });

  it("posts the document's scroll once a frame while it scrolls, and measures no rects for it", async () => {
    cleanup = initPreviewBridge();
    await new Promise((r) => setTimeout(r, 50));
    const postMessage = vi.spyOn(window.parent, "postMessage");
    window.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    expect(sent(postMessage, "scroll")).toEqual([{ __typren: true, type: "scroll", x: 0, y: 0 }]);
    expect(sent(postMessage, "rects")).toHaveLength(0);
    // A scroll inside the page can move blocks: that one measures again.
    document.body.innerHTML = '<div id="pane"></div>';
    document.getElementById("pane")!.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    expect(sent(postMessage, "rects")).toHaveLength(1);
  });

  it("draws the editor's outlines in page coordinates, in its colour, only while editing", async () => {
    document.body.innerHTML = '<div data-typren-index="0">a</div><div data-typren-index="1">b</div>';
    vi.spyOn(document.body.children[1], "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 200, width: 300, height: 120 })
    );
    Object.defineProperty(window, "scrollY", { value: 50, configurable: true });
    cleanup = initPreviewBridge();
    const send = (data: Record<string, unknown>) =>
      window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, ...data }, origin: window.location.origin }));
    send({ type: "outline", active: 1, selected: 0, color: "rgb(1, 2, 3)" });
    await new Promise((r) => requestAnimationFrame(r));
    const host = document.querySelector<HTMLElement>("[data-typren-outlines]")!;
    const [selected, active] = host.shadowRoot!.querySelectorAll("div");
    expect(host.style.getPropertyValue("--typren-outline")).toBe("rgb(1, 2, 3)");
    expect(host.style.pointerEvents).toBe("none");
    expect([active.hidden, active.style.top, active.style.left, active.style.width, active.style.height]).toEqual([
      false,
      "250px",
      "10px",
      "300px",
      "120px",
    ]);
    expect(selected.hidden).toBe(false);
    send({ type: "outline", active: 1, selected: 1 });
    expect(selected.hidden).toBe(true);
    send({ type: "browse" });
    expect(host.hidden).toBe(true);
    cleanup();
    cleanup = () => {};
    expect(document.querySelector("[data-typren-outlines]")).toBeNull();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  it("re-posts rects after a DOM change", async () => {
    cleanup = initPreviewBridge();
    await new Promise((r) => requestAnimationFrame(r));
    const postMessage = vi.spyOn(window.parent, "postMessage");
    document.body.insertAdjacentHTML("beforeend", '<div data-typren-index="1">new</div>');
    await new Promise((r) => setTimeout(r, 50));
    const [msg] = sent(postMessage, "rects") as unknown as { rects: { index: number }[] }[];
    expect(msg.rects.map((r) => r.index)).toEqual([0, 1]);
  });

  it("stops posting once cleaned up", async () => {
    const postMessage = vi.spyOn(window.parent, "postMessage");
    initPreviewBridge()();
    window.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent(postMessage, "rects")).toHaveLength(0);
  });

  it("posts hover only when the hovered block changes, and null over the page background", () => {
    const postMessage = vi.spyOn(window.parent, "postMessage");
    cleanup = initPreviewBridge();
    const block = document.querySelector("[data-typren-index]")!;
    block.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    block.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(sent(postMessage, "hover")).toEqual([
      { __typren: true, type: "hover", index: 0 },
      { __typren: true, type: "hover", index: null },
    ]);
  });

  it("marks no block itself: outlines live on their own layer", () => {
    cleanup = initPreviewBridge();
    window.dispatchEvent(
      new MessageEvent("message", { data: { __typren: true, type: "select", index: 0, reveal: false }, origin: window.location.origin })
    );
    expect(document.querySelector("[data-typren-selected]")).toBeNull();
  });
});

describe("initPreviewBridge style message", () => {
  const send = (vars: unknown) =>
    window.dispatchEvent(
      new MessageEvent("message", { data: { __typren: true, type: "style", vars }, origin: window.location.origin })
    );

  it("applies custom properties live and removes the ones a later message drops", () => {
    cleanup = initPreviewBridge();
    const root = document.documentElement.style;
    send({ "--typren-primary": "red", "--primary": "red", "--typren-radius": "4px", color: "x", "--Bad Name": "x", "--typren-bg": 3 });
    expect(root.getPropertyValue("--typren-primary")).toBe("red");
    expect(root.getPropertyValue("--primary")).toBe("red");
    expect(root.getPropertyValue("--typren-radius")).toBe("4px");
    expect(root.getPropertyValue("color")).toBe("");
    expect(root.getPropertyValue("--typren-bg")).toBe("");

    send({ "--typren-radius": "8px" });
    expect(root.getPropertyValue("--typren-primary")).toBe("");
    expect(root.getPropertyValue("--primary")).toBe("");
    expect(root.getPropertyValue("--typren-radius")).toBe("8px");
    send({});
    expect(root.getPropertyValue("--typren-radius")).toBe("");
  });
});

describe("initPreviewBridge computedStyle message", () => {
  const ask = (data: Record<string, unknown>, origin = window.location.origin) =>
    window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, type: "computedStyle", ...data }, origin }));
  const replies = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => c[0] as { type: string; vars: Record<string, string>; elements: Record<string, unknown> }).filter((m) => m.type === "computedStyle");

  it("answers with the site's own values, the live draft lifted off, colours resolved", () => {
    cleanup = initPreviewBridge();
    const root = document.documentElement.style;
    root.setProperty("--brand", "#ff0000");
    root.setProperty("--gap", "2rem");
    window.dispatchEvent(
      new MessageEvent("message", { data: { __typren: true, type: "style", vars: { "--typren-gap": "9px" } }, origin: window.location.origin })
    );
    document.body.innerHTML = "<h1>Hi</h1>";
    const postMessage = vi.spyOn(window.parent, "postMessage");
    ask({ names: ["--brand", "--gap", "--typren-gap", "--missing", "--Not a name", 3], colors: ["--brand"] });
    const [reply] = replies(postMessage);
    // jsdom leaves var() unresolved in computed colours, so the raw value comes back.
    expect(reply!.vars).toEqual({ "--brand": "#ff0000", "--gap": "2rem" });
    expect(reply!.elements.h1).toBeTruthy();
    expect(reply!.elements.h2).toBeUndefined();
    expect(root.getPropertyValue("--typren-gap")).toBe("9px");
    expect(postMessage.mock.calls[0]![1]).toBe(window.location.origin);
    root.removeProperty("--brand");
    root.removeProperty("--gap");
  });

  it("flattens light-dark(), var() chains and color-mix() to rgb for the frame's scheme", () => {
    cleanup = initPreviewBridge();
    const root = document.documentElement.style;
    root.setProperty("--ink", "light-dark(var(--ink-light), #eeeeee)");
    root.setProperty("--wash", "color-mix(in oklab, var(--ink), white 50%)");
    root.setProperty("--plain", "rgb(1, 2, 3)");
    // What a browser computes for each probe: light-dark() settled for the
    // scheme and var() resolved, with color-mix() kept as oklab().
    const computed: Record<string, string> = {
      "var(--ink)": "rgb(17, 17, 17)",
      "var(--wash)": "oklab(0.6 0 0 / 0.5)",
      "var(--plain)": "rgb(1, 2, 3)",
    };
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) =>
      el instanceof HTMLSpanElement ? ({ color: computed[el.style.color] ?? "" } as CSSStyleDeclaration) : real(el)
    );
    const painted: string[] = [];
    const ctx = {
      fillStyle: "",
      clearRect: () => {},
      fillRect() {
        painted.push(this.fillStyle);
      },
      getImageData: () => ({ data: [128, 128, 128, 128] }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const postMessage = vi.spyOn(window.parent, "postMessage");
    ask({ names: ["--ink", "--wash", "--plain"], colors: ["--ink", "--wash", "--plain"] });
    expect(replies(postMessage)[0]!.vars).toEqual({ "--ink": "rgb(17, 17, 17)", "--wash": "rgba(128, 128, 128, 0.502)", "--plain": "rgb(1, 2, 3)" });
    expect(painted).toEqual(["oklab(0.6 0 0 / 0.5)"]);
    for (const k of ["--ink", "--wash", "--plain"]) root.removeProperty(k);
  });

  it("keeps the engine's colour where there is no canvas, and an opaque pixel as rgb()", () => {
    cleanup = initPreviewBridge();
    const root = document.documentElement.style;
    root.setProperty("--a", "oklch(0.5 0.2 260)");
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) =>
      el instanceof HTMLSpanElement ? ({ color: "oklch(0.5 0.2 260)" } as CSSStyleDeclaration) : real(el)
    );
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("no canvas");
    });
    const postMessage = vi.spyOn(window.parent, "postMessage");
    ask({ names: ["--a"], colors: ["--a"] });
    expect(replies(postMessage)[0]!.vars["--a"]).toBe("oklch(0.5 0.2 260)");
    getContext.mockReturnValue({ fillStyle: "", clearRect() {}, fillRect() {}, getImageData: () => ({ data: [0, 64, 255, 255] }) } as unknown as CanvasRenderingContext2D);
    ask({ names: ["--a"], colors: ["--a"] });
    expect(replies(postMessage)[1]!.vars["--a"]).toBe("rgb(0, 64, 255)");
    root.removeProperty("--a");
  });

  it("ignores the question from any other origin", () => {
    cleanup = initPreviewBridge();
    const postMessage = vi.spyOn(window.parent, "postMessage");
    ask({ names: ["--x"] }, "https://evil.example");
    expect(replies(postMessage)).toHaveLength(0);
  });
});

describe("initPreviewBridge location", () => {
  const host = "https://dashboard.typren.example";
  const locations = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => (c[0] as { type: string }).type === "location").map((c) => [c[0], c[1]]);

  it("posts its path on load and after each navigation, only to the allowed origin", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/about");
    const postMessage = vi.spyOn(window.parent, "postMessage");
    cleanup = initPreviewBridge(host);
    expect(locations(postMessage)).toEqual([[{ __typren: true, type: "location", path: "/about" }, host]]);

    // A client-side router moves with pushState, which fires no event.
    window.history.pushState(null, "", "/faqs/");
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(250);
    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(locations(postMessage).map(([m]) => (m as { path: string }).path)).toEqual(["/about", "/faqs/", "/"]);

    cleanup();
    cleanup = null;
    window.history.pushState(null, "", "/after");
    vi.advanceTimersByTime(500);
    expect(locations(postMessage)).toHaveLength(3);
    vi.useRealTimers();
  });

  it("leaves clicks to the site once the allowed origin says it is browsing", () => {
    document.body.innerHTML = '<div data-typren-index="0"><a href="#next">next</a></div>';
    cleanup = initPreviewBridge(host);
    const postMessage = vi.spyOn(window.parent, "postMessage");
    const link = document.querySelector("a")!;
    const click = () => {
      const e = new MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const browse = (origin: string) =>
      window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, type: "browse" }, origin }));

    browse("https://evil.example");
    expect(click()).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);

    browse(host);
    expect(click()).toBe(false);
    link.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(link.getAttribute("contenteditable")).toBeNull();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("turns back into an edit canvas on `edit`, re-posting its rects", async () => {
    document.body.innerHTML = '<div data-typren-index="0"><a href="#next">next</a></div>';
    cleanup = initPreviewBridge(host);
    const send = (type: string) =>
      window.dispatchEvent(new MessageEvent("message", { data: { __typren: true, type }, origin: host }));
    send("browse");
    await new Promise((r) => requestAnimationFrame(r));
    const postMessage = vi.spyOn(window.parent, "postMessage");
    send("edit");
    await new Promise((r) => requestAnimationFrame(r));
    expect(postMessage.mock.calls.filter(([m]) => (m as { type: string }).type === "rects")).toHaveLength(1);
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("a")!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("initPreviewBridge scrollbar style", () => {
  it("swaps the native bar for an overlay thumb only while connected", () => {
    cleanup = initPreviewBridge();
    const style = document.getElementById("typren-preview-bridge-scrollbar");
    expect(style?.textContent).toContain("scrollbar-width:none");
    const thumb = document.getElementById("typren-preview-scroll-thumb")!;
    expect(thumb.getAttribute("aria-hidden")).toBe("true");

    window.dispatchEvent(new Event("scroll"));
    expect(thumb.hasAttribute("data-shown")).toBe(true);

    cleanup();
    cleanup = null;
    expect(document.getElementById("typren-preview-bridge-scrollbar")).toBeNull();
    expect(document.getElementById("typren-preview-scroll-thumb")).toBeNull();
  });

  it("adds no scrollbar style when the bridge stays inert", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanup = initPreviewBridge("*");
    expect(document.getElementById("typren-preview-bridge-scrollbar")).toBeNull();
    expect(document.getElementById("typren-preview-scroll-thumb")).toBeNull();
  });
});
