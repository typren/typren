import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstRunNotice, isEnabled, record, setEnabled } from "./telemetry";

let configDir: string;
let originalEnv: NodeJS.ProcessEnv;

// Every opt-out env var this module reads, cleared before each test so one
// test's setting can never leak into the next.
const ENV_KEYS = ["XDG_CONFIG_HOME", "APPDATA", "CI", "DO_NOT_TRACK", "TYPREN_TELEMETRY", "TYPREN_TELEMETRY_URL"];

beforeEach(() => {
  originalEnv = { ...process.env };
  for (const key of ENV_KEYS) delete process.env[key];
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-telemetry-"));
  process.env.XDG_CONFIG_HOME = configDir;
});

afterEach(() => {
  process.env = originalEnv;
  fs.rmSync(configDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function stateFile(): string {
  return path.join(configDir, "typren", "telemetry.json");
}

function readStateFile(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
}

describe("isEnabled", () => {
  it("defaults to enabled with no opt-out set", () => {
    expect(isEnabled()).toBe(true);
  });

  it("is disabled when CI is set", () => {
    process.env.CI = "true";
    expect(isEnabled()).toBe(false);
  });

  it.each(["1", "true", "TRUE"])("is disabled when DO_NOT_TRACK=%s", (value) => {
    process.env.DO_NOT_TRACK = value;
    expect(isEnabled()).toBe(false);
  });

  it("is not disabled by an unrecognized DO_NOT_TRACK value", () => {
    process.env.DO_NOT_TRACK = "yes";
    expect(isEnabled()).toBe(true);
  });

  it.each(["0", "false", "FALSE"])("is disabled when TYPREN_TELEMETRY=%s", (value) => {
    process.env.TYPREN_TELEMETRY = value;
    expect(isEnabled()).toBe(false);
  });

  it("is disabled when the persisted config says off", () => {
    setEnabled(false);
    expect(isEnabled()).toBe(false);
  });

  it("setEnabled(false) sticks across separate calls", () => {
    setEnabled(false);
    expect(isEnabled()).toBe(false);
    expect(isEnabled()).toBe(false);
    expect(readStateFile().enabled).toBe(false);
  });

  it("setEnabled(true) overrides a prior opt-out but not an env opt-out", () => {
    setEnabled(false);
    setEnabled(true);
    expect(isEnabled()).toBe(true);

    process.env.CI = "1";
    expect(isEnabled()).toBe(false);
  });
});

describe("firstRunNotice", () => {
  // The notice only appears when telemetry can actually fire, which needs a
  // collector, so these set one. The no-collector case is its own test below.
  beforeEach(() => {
    process.env.TYPREN_TELEMETRY_URL = "https://collector.invalid/e";
  });

  it("returns text the first time and null after", () => {
    const first = firstRunNotice();
    expect(first).toBeTypeOf("string");
    expect(first).toMatch(/telemetry/i);
    expect(firstRunNotice()).toBeNull();
  });

  it("mentions what is collected and how to opt out", () => {
    const notice = firstRunNotice();
    expect(notice).toContain("install id");
    expect(notice).toContain("DO_NOT_TRACK");
  });

  it("persists across a fresh read of state, not just in memory", () => {
    firstRunNotice();
    expect(readStateFile().noticeShown).toBe(true);
    expect(firstRunNotice()).toBeNull();
  });

  it("never returns text when telemetry is disabled", () => {
    process.env.CI = "1";
    expect(firstRunNotice()).toBeNull();
    // Nothing was "shown" while disabled, so it's still owed once telemetry
    // becomes possible again.
    delete process.env.CI;
    expect(firstRunNotice()).toBeTypeOf("string");
  });

  it("stays silent when no collector is configured, since nothing is sent", () => {
    // Announcing collection that is not happening would be a false claim, and
    // it would train people to ignore the notice that eventually matters.
    delete process.env.TYPREN_TELEMETRY_URL;
    expect(firstRunNotice()).toBeNull();
    // Still owed: the notice was never actually shown, so configuring a
    // collector later must surface it rather than skipping it silently.
    expect(fs.existsSync(stateFile()) && readStateFile().noticeShown).not.toBe(true);
    process.env.TYPREN_TELEMETRY_URL = "https://collector.invalid/e";
    expect(firstRunNotice()).toBeTypeOf("string");
  });
});

describe("record", () => {
  it("makes no network call when TYPREN_TELEMETRY_URL is unset", () => {
    const httpSpy = vi.spyOn(http, "request");
    const httpsSpy = vi.spyOn(https, "request");
    record("init");
    expect(httpSpy).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
  });

  it("makes no network call when telemetry is disabled, even with a URL set", () => {
    process.env.TYPREN_TELEMETRY_URL = "http://collector.example/collect";
    process.env.TYPREN_TELEMETRY = "0";
    const httpSpy = vi.spyOn(http, "request");
    record("init");
    expect(httpSpy).not.toHaveBeenCalled();
  });

  it("swallows a malformed TYPREN_TELEMETRY_URL instead of throwing", () => {
    process.env.TYPREN_TELEMETRY_URL = "not a valid url";
    const httpSpy = vi.spyOn(http, "request");
    expect(() => record("init")).not.toThrow();
    expect(httpSpy).not.toHaveBeenCalled();
  });

  function fakeRequest() {
    return { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
  }

  it("sends exactly {installId, cliVersion, nodeVersion, platform, command} over http", () => {
    process.env.TYPREN_TELEMETRY_URL = "http://collector.example/collect";
    const req = fakeRequest();
    const httpSpy = vi.spyOn(http, "request").mockReturnValue(req as unknown as http.ClientRequest);

    record("apply-settings");

    expect(httpSpy).toHaveBeenCalledTimes(1);
    const [options, onResponse] = httpSpy.mock.calls[0];
    expect(options).toMatchObject({
      hostname: "collector.example",
      port: 80,
      path: "/collect",
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    // The response is drained and discarded, never inspected.
    const resume = vi.fn();
    (onResponse as (res: { resume: () => void }) => void)({ resume });
    expect(resume).toHaveBeenCalled();

    const body = JSON.parse(req.end.mock.calls[0][0] as string);
    expect(Object.keys(body).sort()).toEqual(["cliVersion", "command", "installId", "nodeVersion", "platform"].sort());
    expect(body).toEqual({
      installId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      cliVersion: expect.any(String),
      nodeVersion: process.version,
      platform: process.platform,
      command: "apply-settings",
    });
  });

  it("uses https for an https:// endpoint", () => {
    process.env.TYPREN_TELEMETRY_URL = "https://collector.example/collect";
    const req = fakeRequest();
    const httpsSpy = vi.spyOn(https, "request").mockReturnValue(req as unknown as http.ClientRequest);
    const httpSpy = vi.spyOn(http, "request");

    record("init");

    expect(httpsSpy).toHaveBeenCalledTimes(1);
    expect(httpSpy).not.toHaveBeenCalled();
    const [options] = httpsSpy.mock.calls[0];
    expect(options).toMatchObject({ hostname: "collector.example", port: 443 });
  });

  it("registers an error handler and unrefs the socket so a dead collector can't hang the process", () => {
    process.env.TYPREN_TELEMETRY_URL = "http://collector.example/collect";
    const req = fakeRequest();
    vi.spyOn(http, "request").mockReturnValue(req as unknown as http.ClientRequest);

    record("init");

    const registered = req.on.mock.calls.map((call) => call[0]);
    expect(registered).toEqual(expect.arrayContaining(["error", "timeout", "socket"]));

    const socketHandler = req.on.mock.calls.find((call) => call[0] === "socket")?.[1] as (s: { unref: () => void }) => void;
    const socket = { unref: vi.fn() };
    socketHandler(socket);
    expect(socket.unref).toHaveBeenCalled();

    const timeoutHandler = req.on.mock.calls.find((call) => call[0] === "timeout")?.[1] as () => void;
    timeoutHandler();
    expect(req.destroy).toHaveBeenCalled();
  });

  it("reuses the same installId across separate record calls", () => {
    process.env.TYPREN_TELEMETRY_URL = "http://collector.example/collect";
    const first = fakeRequest();
    vi.spyOn(http, "request").mockReturnValueOnce(first as unknown as http.ClientRequest);
    record("init");
    const firstBody = JSON.parse(first.end.mock.calls[0][0] as string);

    const second = fakeRequest();
    vi.spyOn(http, "request").mockReturnValueOnce(second as unknown as http.ClientRequest);
    record("review");
    const secondBody = JSON.parse(second.end.mock.calls[0][0] as string);

    expect(secondBody.installId).toBe(firstBody.installId);
    expect(readStateFile().installId).toBe(firstBody.installId);
  });
});

describe("config file location", () => {
  it("uses XDG_CONFIG_HOME/typren/telemetry.json when set", () => {
    setEnabled(true);
    expect(fs.existsSync(stateFile())).toBe(true);
  });

  it("falls back to ~/Library/Preferences/typren on darwin without XDG_CONFIG_HOME", () => {
    delete process.env.XDG_CONFIG_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "typren-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    try {
      setEnabled(true);
      expect(fs.existsSync(path.join(home, "Library", "Preferences", "typren", "telemetry.json"))).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("falls back to %APPDATA%/typren on win32 without XDG_CONFIG_HOME", () => {
    delete process.env.XDG_CONFIG_HOME;
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "typren-appdata-"));
    process.env.APPDATA = appData;
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    try {
      setEnabled(true);
      expect(fs.existsSync(path.join(appData, "typren", "telemetry.json"))).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      fs.rmSync(appData, { recursive: true, force: true });
    }
  });

  it("falls back to ~/.config/typren on linux without XDG_CONFIG_HOME", () => {
    delete process.env.XDG_CONFIG_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "typren-home-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    try {
      setEnabled(true);
      expect(fs.existsSync(path.join(home, ".config", "typren", "telemetry.json"))).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
