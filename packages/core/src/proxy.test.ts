import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentAdminRoute, typrenProxyRewrite, typrenBlocksDirectStudioAccess, previewPathFor } from "./proxy";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-proxy-"));
  file = path.join(dir, "typren.config.json");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("currentAdminRoute", () => {
  it("defaults to \"studio\" when the config file doesn't exist", () => {
    expect(currentAdminRoute(file)).toBe("studio");
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
    expect(previewPathFor("studio")).toBe("/studio/preview");
    expect(previewPathFor("backoffice")).toBe("/backoffice/preview");
  });
});

describe("typrenProxyRewrite", () => {
  it("maps a renamed admin route's prefix to /studio", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "backoffice" }));
    expect(typrenProxyRewrite("/backoffice", { configFile: file })).toBe("/studio");
    expect(typrenProxyRewrite("/backoffice/preview", { configFile: file })).toBe("/studio/preview");
    expect(typrenProxyRewrite(new URL("http://x/backoffice/pages/home"), { configFile: file })).toBe(
      "/studio/pages/home"
    );
  });

  it("keeps a stored pre-rename \"editor\" URL working once the routes live under /studio", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "editor" }));
    expect(typrenProxyRewrite("/editor/pages/home", { configFile: file })).toBe("/studio/pages/home");
    expect(typrenBlocksDirectStudioAccess("/studio/pages/home", { configFile: file })).toBe(true);
  });

  it("returns null for a path outside the admin route", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "backoffice" }));
    expect(typrenProxyRewrite("/blog/post-1", { configFile: file })).toBeNull();
    // Prefix collision, not a real path segment match.
    expect(typrenProxyRewrite("/backofficexyz", { configFile: file })).toBeNull();
  });

  it("returns null when adminRoute is still the default \"studio\" (nothing to rewrite)", () => {
    expect(typrenProxyRewrite("/studio/pages/home", { configFile: file })).toBeNull();
  });
});

describe("typrenBlocksDirectStudioAccess", () => {
  // Regression: renaming adminRoute was pure URL hygiene -- the module's own
  // doc comment claimed "/studio/** itself 404s for anyone hitting it
  // directly post-rename" but nothing ever enforced that, so the OLD path
  // kept serving the studio side by side with the new one indefinitely.
  it("blocks direct /studio access once adminRoute is renamed", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "backoffice" }));
    expect(typrenBlocksDirectStudioAccess("/studio", { configFile: file })).toBe(true);
    expect(typrenBlocksDirectStudioAccess("/studio/pages/home", { configFile: file })).toBe(true);
    expect(typrenBlocksDirectStudioAccess(new URL("http://x/studio/preview"), { configFile: file })).toBe(true);
  });

  it("does not block the renamed route itself, or unrelated paths", () => {
    fs.writeFileSync(file, JSON.stringify({ adminRoute: "backoffice" }));
    expect(typrenBlocksDirectStudioAccess("/backoffice/pages/home", { configFile: file })).toBe(false);
    expect(typrenBlocksDirectStudioAccess("/blog/post-1", { configFile: file })).toBe(false);
    // Prefix collision, not a real path segment match.
    expect(typrenBlocksDirectStudioAccess("/studious", { configFile: file })).toBe(false);
  });

  it("does not block /studio when adminRoute is still the default (it IS the live route)", () => {
    expect(typrenBlocksDirectStudioAccess("/studio/pages/home", { configFile: file })).toBe(false);
  });
});
