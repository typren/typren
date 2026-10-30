import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  browserCommand,
  buildStudioManifest,
  connectUrl,
  parseStudioArgs as parseWithEnv,
  previewCommand,
  resolveSite,
  resolveStudioDir,
  runStudio,
  studioCommand,
  waitForUrl,
  type Command,
  type StudioDeps,
} from "./studio";

const CLOUD = "https://app.typren.com";
// The real env could carry TYPREN_CLOUD_URL; these tests pin an empty one.
const parseStudioArgs = (args: string[]) => parseWithEnv(args, {});

let dir: string;

beforeEach(() => {
  // Inside the package, not os.tmpdir(): vitest's module runner won't import
  // a .ts file from outside the project root, and the manifest imports some.
  dir = fs.mkdtempSync(path.join(import.meta.dirname, "..", ".tmp-studio-"));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("parseStudioArgs", () => {
  it("defaults to port 4400 with the preview one port above it", () => {
    expect(parseStudioArgs(["studio"])).toEqual({ port: 4400, previewPort: 4401, cloudUrl: CLOUD });
    expect(parseStudioArgs(["studio", "--port", "5000"])).toEqual({ port: 5000, previewPort: 5001, cloudUrl: CLOUD });
  });

  it("takes --preview-port, and reduces --site-url to its origin", () => {
    expect(parseStudioArgs(["studio", "--preview-port", "6000", "--site-url", "http://localhost:4321/blog/"])).toEqual({
      port: 4400,
      previewPort: 6000,
      siteUrl: "http://localhost:4321",
      cloudUrl: CLOUD,
    });
  });

  it("opens in the cloud by default, and runs the local studio with --local", () => {
    expect(parseStudioArgs(["studio", "--cloud"])).toMatchObject({ cloudUrl: CLOUD });
    expect(parseStudioArgs(["studio", "--local"])).toEqual({ port: 4400, previewPort: 4401 });
  });

  it("takes the cloud URL from --cloud-url over TYPREN_CLOUD_URL, reduced to its origin", () => {
    expect(parseWithEnv(["studio"], { TYPREN_CLOUD_URL: "http://127.0.0.1:3300/" })).toMatchObject({ cloudUrl: "http://127.0.0.1:3300" });
    expect(parseWithEnv(["studio", "--cloud-url", "https://cloud.test/x"], { TYPREN_CLOUD_URL: "http://127.0.0.1:3300" })).toMatchObject({
      cloudUrl: "https://cloud.test",
    });
  });

  it.each([["http://cloud.test"], ["ftp://cloud.test"], ["cloud.test"], [""]])("rejects cloud URL %j", (url) => {
    expect(parseStudioArgs(["studio", "--cloud-url", url])).toEqual({ error: expect.stringContaining("--cloud-url") });
  });

  it.each([["0"], ["70000"], ["abc"], [""]])("rejects port %j", (port) => {
    expect(parseStudioArgs(["studio", "--port", port])).toEqual({ error: expect.stringContaining("--port") });
    expect(parseStudioArgs(["studio", "--preview-port", port])).toEqual({ error: expect.stringContaining("--preview-port") });
  });

  it("rejects a missing --port value", () => {
    expect(parseStudioArgs(["studio", "--port"])).toEqual({ error: expect.stringContaining("--port") });
  });

  it("rejects a relative or non-http site URL", () => {
    expect(parseStudioArgs(["studio", "--site-url", "/about"])).toEqual({ error: expect.stringContaining("absolute") });
    expect(parseStudioArgs(["studio", "--site-url", "file:///tmp"])).toEqual({ error: expect.stringContaining("http(s)") });
    expect(parseStudioArgs(["studio", "--site-url"])).toEqual({ error: expect.stringContaining("absolute") });
  });
});

describe("connectUrl and browserCommand", () => {
  it("puts port and token in the fragment, never the query", () => {
    const url = new URL(connectUrl(CLOUD, 4400, "abc_-"));
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/connect");
    expect(url.hash).toBe("#port=4400&token=abc_-");
  });

  it("opens the URL as one argument, never through a shell", () => {
    expect(browserCommand("https://x/#a&b", "darwin")).toMatchObject({ command: "open", args: ["https://x/#a&b"] });
    expect(browserCommand("https://x/#a&b", "linux")).toMatchObject({ command: "xdg-open", args: ["https://x/#a&b"] });
    expect(browserCommand("https://x/#a&b", "win32")).toMatchObject({ command: "rundll32", args: ["url.dll,FileProtocolHandler", "https://x/#a&b"] });
  });
});

describe("buildStudioManifest", () => {
  const slices = (files: Record<string, string>) => {
    fs.mkdirSync(path.join(dir, "src", "slices"), { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, "src", "slices", name), text);
  };

  it("reads defaults and field hints from the slices dir beside the content dir", async () => {
    slices({
      "defaults.ts": 'export const defaults: Record<string, Record<string, unknown>> = { hero: { heading: "Hi" } };\n',
      "field-schema.ts":
        'import type { SliceSchema } from "@typren/core";\n' +
        'export const fieldSchema: Record<string, SliceSchema> = { hero: { align: { type: "select", options: ["left"] } } };\n',
    });
    expect(await buildStudioManifest(dir, "http://127.0.0.1:3000")).toEqual({
      siteDir: dir,
      contentDir: path.join(dir, "src", "content"),
      siteUrl: "http://127.0.0.1:3000",
      defaults: { hero: { heading: "Hi" } },
      fieldSchema: { hero: { align: { type: "select", options: ["left"] } } },
      writeBootstrap: false,
    });
  });

  it("carries a valid studio.style map from typren.config.json and refuses an unsafe one", async () => {
    slices({ "defaults.ts": "export const defaults = { hero: {} };\n" });
    fs.writeFileSync(path.join(dir, "typren.config.json"), JSON.stringify({ studio: { style: { "--typren-primary": "--brand" } } }));
    expect(await buildStudioManifest(dir, "http://127.0.0.1:3000")).toMatchObject({ styleMap: { "--typren-primary": "--brand" } });
    fs.writeFileSync(path.join(dir, "typren.config.json"), JSON.stringify({ studio: { style: { "--typren-primary": "--brand; }" } } }));
    expect(await buildStudioManifest(dir, "http://127.0.0.1:3000")).toEqual({
      error: expect.stringContaining("studio.style"),
    });
  });

  it("treats field-schema.ts as optional", async () => {
    slices({ "defaults.ts": "export const defaults = { prose: {} };\n" });
    expect(await buildStudioManifest(dir, "http://x")).toMatchObject({
      defaults: { prose: {} },
      fieldSchema: undefined,
    });
  });

  it("fails without slices/defaults.ts", async () => {
    expect(await buildStudioManifest(dir, "http://x")).toEqual({
      error: expect.stringContaining("typren init"),
    });
  });

  describe("the studio block", () => {
    const config = (studio: unknown) => fs.writeFileSync(path.join(dir, "typren.config.json"), JSON.stringify({ studio }));
    const defaults = { "defaults.ts": "export const defaults = { hero: {} };\n" };

    it("prefers whichever of src/content or content exists, and studio.contentDir over both", async () => {
      fs.mkdirSync(path.join(dir, "src"));
      fs.mkdirSync(path.join(dir, "content"));
      fs.mkdirSync(path.join(dir, "slices"));
      fs.writeFileSync(path.join(dir, "slices", "defaults.ts"), defaults["defaults.ts"]);
      expect(await buildStudioManifest(dir, "http://x")).toMatchObject({ contentDir: path.join(dir, "content") });
      config({ contentDir: "docs/pages", slicesDir: "slices" });
      expect(await buildStudioManifest(dir, "http://x")).toMatchObject({ contentDir: path.join(dir, "docs", "pages") });
    });

    it("reads slices from studio.slicesDir", async () => {
      fs.mkdirSync(path.join(dir, "lib"));
      fs.writeFileSync(path.join(dir, "lib", "defaults.ts"), defaults["defaults.ts"]);
      config({ slicesDir: "lib" });
      expect(await buildStudioManifest(dir, "http://x")).toMatchObject({ defaults: { hero: {} }, writeBootstrap: true });
    });

    it("names studio.slicesDir and the no-JSX rule when defaults.ts is missing", async () => {
      expect(await buildStudioManifest(dir, "http://x")).toEqual({
        error: expect.stringMatching(/studio\.slicesDir.*defaults\.ts.*no props or JSX/s),
      });
    });

    it("carries the site facts through to the manifest", async () => {
      slices(defaults);
      const facts = {
        sections: [{ kind: "pages", label: "Pages" }, { kind: "custom", id: "x", label: "X", element: "x-el" }],
        media: { dir: "static/uploads", publicPath: "/uploads" },
        previewPath: "/draft",
        homeSlug: "index",
        sectionRoute: false,
        nestedLayouts: ["/blog"],
      };
      config(facts);
      expect(await buildStudioManifest(dir, "http://x")).toMatchObject(facts);
    });

    it.each([
      [{ contentDir: "" }, "studio.contentDir"],
      [{ homeSlug: 1 }, "studio.homeSlug"],
      [{ previewPath: "draft" }, "studio.previewPath"],
      [{ sectionRoute: true }, "studio.sectionRoute"],
      [{ nestedLayouts: "/blog" }, "studio.nestedLayouts"],
      [{ nestedLayouts: ["blog"] }, "studio.nestedLayouts"],
      [{ sections: {} }, "studio.sections must be an array"],
      [{ sections: [null] }, "studio.sections[0] must be an object"],
      [{ sections: [{ kind: "nope", label: "A" }] }, "studio.sections[0].kind"],
      [{ sections: [{ kind: "pages" }] }, "studio.sections[0].label"],
      [{ sections: [{ kind: "pages", label: "A", id: 1 }] }, "studio.sections[0].id"],
      [{ sections: [{ kind: "custom", label: "A" }] }, "exactly one of element"],
      [{ sections: [{ kind: "custom", label: "A", element: "a-b", host: true }] }, "exactly one of element"],
      [{ contentDir: "../../etc" }, "studio.contentDir must be a directory inside the site root"],
      [{ contentDir: "/etc" }, "studio.contentDir must be a directory inside the site root"],
      [{ slicesDir: "src/../../x" }, "studio.slicesDir must be a directory inside the site root"],
      [{ media: { dir: "../out", publicPath: "/img" } }, "studio.media.dir"],
      [{ media: { dir: "/abs", publicPath: "/img" } }, "studio.media.dir"],
      [{ media: { dir: "a/../../b", publicPath: "/img" } }, "studio.media.dir"],
      [{ media: { publicPath: "/img" } }, "studio.media.dir"],
      [{ media: { dir: "img", publicPath: "img" } }, "studio.media.publicPath"],
    ])("rejects %j", async (studio, message) => {
      slices(defaults);
      config(studio);
      expect(await buildStudioManifest(dir, "http://x")).toEqual({ error: expect.stringContaining(message) });
    });
  });

  it("reports a slice file that can't be imported", async () => {
    slices({ "defaults.ts": 'import { x } from "@/nowhere";\nexport const defaults = x;\n' });
    expect(await buildStudioManifest(dir, "http://x")).toEqual({
      error: expect.stringContaining("couldn't load slice data"),
    });
  });
});

describe("resolveSite", () => {
  it("reads the site's facts without its slice data", () => {
    fs.mkdirSync(path.join(dir, "content"));
    expect(resolveSite(dir)).toEqual({ siteDir: dir, contentDir: path.join(dir, "content"), writeBootstrap: false });
    const studio = { media: { dir: "static", publicPath: "/s" }, homeSlug: "index", style: { "--typren-primary": "--brand" } };
    fs.writeFileSync(path.join(dir, "typren.config.json"), JSON.stringify({ studio }));
    expect(resolveSite(dir)).toEqual({
      siteDir: dir,
      contentDir: path.join(dir, "content"),
      media: studio.media,
      homeSlug: "index",
      styleMap: studio.style,
      writeBootstrap: true,
    });
    fs.writeFileSync(path.join(dir, "typren.config.json"), JSON.stringify({ studio: { homeSlug: "" } }));
    expect(resolveSite(dir)).toEqual({ error: expect.stringContaining("studio.homeSlug") });
  });
});

describe("resolveStudioDir", () => {
  it("finds the studio beside this CLI when the site doesn't install it", () => {
    const studio = resolveStudioDir(dir);
    expect(studio && JSON.parse(fs.readFileSync(path.join(studio, "package.json"), "utf8")).name).toBe("@typren/studio-local");
  });

  it("returns null when it is installed nowhere", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "typren-studio-"));
    try {
      expect(resolveStudioDir(outside, path.join(outside, "cli.js"))).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("studioCommand", () => {
  it("runs next dev on loopback with the manifest in the environment", () => {
    const studioDir = resolveStudioDir(dir)!;
    const manifest = { siteDir: dir, contentDir: dir, siteUrl: "http://127.0.0.1:3000", defaults: {} };
    const { command, args, options } = studioCommand(studioDir, manifest, 4400);
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/next[\\/]dist[\\/]bin[\\/]next$/);
    expect(args.slice(1)).toEqual(["dev", "-H", "127.0.0.1", "-p", "4400"]);
    expect(options.cwd).toBe(studioDir);
    expect(JSON.parse(options.env.TYPREN_STUDIO!)).toEqual(manifest);
  });
});

describe("previewCommand", () => {
  it.each([
    ["pnpm-lock.yaml", ["pnpm", "run", "dev", "-p", "4401", "-H", "127.0.0.1"]],
    ["yarn.lock", ["yarn", "run", "dev", "-p", "4401", "-H", "127.0.0.1"]],
    ["bun.lock", ["bun", "run", "dev", "-p", "4401", "-H", "127.0.0.1"]],
    ["package-lock.json", ["npm", "run", "dev", "--", "-p", "4401", "-H", "127.0.0.1"]],
  ])("runs the dev script through the package manager behind %s, with Next's port flags", (lockfile, argv) => {
    fs.writeFileSync(path.join(dir, lockfile), "");
    const { command, args } = previewCommand(dir, 4401, "http://127.0.0.1:4400");
    expect([command, ...args]).toEqual(argv);
  });

  it("defaults to npm with no lockfile, and sets preview mode, the studio origin and the port", () => {
    const { command, args, options } = previewCommand(dir, 4401, "http://127.0.0.1:4400");
    expect([command, ...args]).toEqual(["npm", "run", "dev", "--", "-p", "4401", "-H", "127.0.0.1"]);
    expect(options).toMatchObject({
      cwd: dir,
      env: { TYPREN_PREVIEW: "1", TYPREN_STUDIO_ORIGIN: "http://127.0.0.1:4400", PORT: "4401" },
    });
  });

  it("takes studio.previewCommand from typren.config.json, filling in {port}", () => {
    fs.writeFileSync(
      path.join(dir, "typren.config.json"),
      JSON.stringify({ studio: { previewCommand: "npx astro dev --port {port}  --host 127.0.0.1" } })
    );
    const { command, args } = previewCommand(dir, 5001, "http://x");
    expect([command, ...args]).toEqual(["npx", "astro", "dev", "--port", "5001", "--host", "127.0.0.1"]);
  });

  it("falls back to the default on a malformed typren.config.json", () => {
    fs.writeFileSync(path.join(dir, "typren.config.json"), "{");
    expect(previewCommand(dir, 4401, "http://x").command).toBe("npm");
  });
});

const fast = { timeoutMs: 200, intervalMs: 1 };

describe("waitForUrl", () => {
  it("polls until the URL answers", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValue(new Response(null, { status: 404 }));
    expect(await waitForUrl("http://x", () => false, { fetch, ...fast })).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up when stopped or out of time", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await waitForUrl("http://x", () => true, { fetch, ...fast })).toBe(false);
    expect(await waitForUrl("http://x", () => false, { fetch, ...fast, timeoutMs: 5 })).toBe(false);
  });
});

type FakeChild = ChildProcess & EventEmitter & { kill: ReturnType<typeof vi.fn> };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(() => true) });
  return child;
}

describe("runStudio", () => {
  const cmd = (command: string): Command => ({ command, args: [], options: { env: {} } });
  const plan = { studio: cmd("studio"), studioUrl: "http://127.0.0.1:4400", siteUrl: "http://127.0.0.1:4401" };

  function setup(fetch: StudioDeps["fetch"]) {
    const preview = fakeChild();
    const studio = fakeChild();
    const signals = new EventEmitter();
    const deps = {
      spawn: vi.fn().mockReturnValueOnce(preview).mockReturnValueOnce(studio),
      fetch,
      log: vi.fn(),
      error: vi.fn(),
      signals: signals as unknown as StudioDeps["signals"],
      ...fast,
    };
    return { preview, studio, signals, deps };
  }

  const up = () => vi.fn().mockResolvedValue(new Response(null));

  it("starts the preview, waits for it, runs the studio, and stops the preview when the studio exits", async () => {
    const { preview, studio, deps } = setup(vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(new Response(null)));
    const run = runStudio({ ...plan, preview: cmd("npm") }, deps);
    await vi.waitFor(() => expect(deps.spawn).toHaveBeenCalledTimes(2));
    expect(deps.spawn.mock.calls[0][2]).toMatchObject({ stdio: ["ignore", "pipe", "pipe"] });
    expect(deps.spawn.mock.calls[1][2]).toMatchObject({ stdio: "inherit" });
    await vi.waitFor(() => expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("previewing http://127.0.0.1:4401")));
    studio.emit("exit", 0);
    expect(await run).toBe(0);
    expect(preview.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("reports a preview that exits before it is ready, with its output, and never starts the studio", async () => {
    const { preview, deps } = setup(vi.fn().mockRejectedValue(new Error("down")));
    const run = runStudio({ ...plan, preview: cmd("npm") }, deps);
    preview.stderr!.emit("data", Buffer.from("Error: next not found"));
    preview.emit("exit", 127);
    expect(await run).toBe(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringMatching(/exited with code 127:\nError: next not found/));
    expect(deps.spawn).toHaveBeenCalledTimes(1);
  });

  it("stops a preview that never answers", async () => {
    const { preview, deps } = setup(vi.fn().mockRejectedValue(new Error("down")));
    expect(await runStudio({ ...plan, preview: cmd("npm") }, deps)).toBe(1);
    expect(preview.kill).toHaveBeenCalledWith("SIGTERM");
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("didn't answer at http://127.0.0.1:4401"));
  });

  it("ends the session when the preview crashes after start, printing its output", async () => {
    const { preview, studio, deps } = setup(up());
    const run = runStudio({ ...plan, preview: cmd("npm") }, deps);
    await vi.waitFor(() => expect(deps.spawn).toHaveBeenCalledTimes(2));
    preview.stdout!.emit("data", "boom");
    preview.emit("exit", 1);
    expect(studio.kill).toHaveBeenCalledWith("SIGTERM");
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
    studio.emit("exit", null);
    expect(await run).toBe(1);
    expect(preview.kill).not.toHaveBeenCalled();
  });

  it("stops both on a signal and exits cleanly", async () => {
    const { preview, studio, signals, deps } = setup(up());
    const run = runStudio({ ...plan, preview: cmd("npm") }, deps);
    await vi.waitFor(() => expect(deps.spawn).toHaveBeenCalledTimes(2));
    signals.emit("SIGINT", "SIGINT");
    expect(preview.kill).toHaveBeenCalledWith("SIGTERM");
    expect(studio.kill).toHaveBeenCalledWith("SIGINT");
    preview.emit("exit", null);
    studio.emit("exit", null);
    expect(await run).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(deps.error).not.toHaveBeenCalled();
  });

  it("spawns only the studio for --site-url, passing its exit code through", async () => {
    const { deps } = setup(up());
    const studio = fakeChild();
    deps.spawn = vi.fn().mockReturnValue(studio);
    const run = runStudio(plan, deps);
    await vi.waitFor(() => expect(deps.spawn).toHaveBeenCalledTimes(1));
    studio.emit("exit", 3);
    expect(await run).toBe(3);
  });

  it("reports a studio killed from outside as a failure", async () => {
    const { deps } = setup(up());
    const studio = fakeChild();
    deps.spawn = vi.fn().mockReturnValue(studio);
    const run = runStudio(plan, deps);
    await vi.waitFor(() => expect(deps.spawn).toHaveBeenCalledTimes(1));
    studio.emit("exit", null);
    expect(await run).toBe(1);
  });

  it("runs an in-process foreground for the cloud, then prints and opens the connect link", async () => {
    const { preview, deps } = setup(up());
    let exit!: (code: number | null) => void;
    const stop = vi.fn(() => exit(0));
    const open = vi.fn();
    const run = runStudio(
      { ...plan, studio: async () => ({ stop, exited: new Promise((r) => (exit = r)) }), preview: cmd("npm"), openUrl: "https://c/connect#t" },
      { ...deps, open }
    );
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("https://c/connect#t"));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("https://c/connect#t"));
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    preview.emit("exit", 1);
    expect(stop).toHaveBeenCalledWith("SIGTERM");
    expect(await run).toBe(1);
  });

  it("reports an API server that cannot start, and stops the preview", async () => {
    const { preview, deps } = setup(up());
    const run = runStudio({ ...plan, studio: () => Promise.reject(new Error("EADDRINUSE")), preview: cmd("npm") }, deps);
    expect(await run).toBe(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("EADDRINUSE"));
    expect(preview.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
