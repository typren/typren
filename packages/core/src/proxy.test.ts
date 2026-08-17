import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentAdminRoute, typrenProxyRewrite, previewPathFor } from "./proxy";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-proxy-"));
  file = path.join(dir, "typren.config.json");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("currentAdminRoute", () => {
  it("defaults to \"editor\" when the config file doesn't exist", () => {
    expect(currentAdminRoute(file)).toBe("editor");
  });

  it("reads adminRoute, then mtime-caches until the file changes", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "backoffice" }));
    expect(currentAdminRoute(file)).toBe("backoffice");

    // Same read, no write in between: cache hit, still the same value.
    expect(currentAdminRoute(file)).toBe("backoffice");

    // Rewrite with a new mtime: cache invalidates, new value wins.
    const stat = fs.statSync(file);
    const future = new Date(stat.mtime.getTime() + 60_000);
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "renamed" }));
    fs.utimesSync(file, future, future);
    expect(currentAdminRoute(file)).toBe("renamed");
  });
});

describe("previewPathFor", () => {
  it("derives the preview path from the admin route", () => {
    expect(previewPathFor("editor")).toBe("/editor/preview");
    expect(previewPathFor("backoffice")).toBe("/backoffice/preview");
  });
});

describe("typrenProxyRewrite", () => {
  it("maps a renamed admin route's prefix to /editor", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "backoffice" }));
    expect(typrenProxyRewrite("/backoffice", { configFile: file })).toBe("/editor");
    expect(typrenProxyRewrite("/backoffice/preview", { configFile: file })).toBe("/editor/preview");
    expect(typrenProxyRewrite(new URL("http://x/backoffice/pages/home"), { configFile: file })).toBe(
      "/editor/pages/home"
    );
  });

  it("returns null for a path outside the admin route", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "backoffice" }));
    expect(typrenProxyRewrite("/blog/post-1", { configFile: file })).toBeNull();
    // Prefix collision, not a real path segment match.
    expect(typrenProxyRewrite("/backofficexyz", { configFile: file })).toBeNull();
  });

  it("returns null when adminRoute is still the default \"editor\" (nothing to rewrite)", () => {
    expect(typrenProxyRewrite("/editor/pages/home", { configFile: file })).toBeNull();
  });
});
