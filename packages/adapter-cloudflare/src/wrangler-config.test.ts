import { describe, expect, it } from "vitest";
import { renderWranglerConfig } from "./wrangler-config";

/** `wrangler.jsonc` allows `//` comments; strip them the same way a reader
 *  skimming the file would, to confirm the rest still parses as JSON. */
function stripComments(jsonc: string): string {
  return jsonc
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("renderWranglerConfig", () => {
  it("renders the canonical shape with no domains", () => {
    const config = renderWranglerConfig({ name: "my-site", compatibilityDate: "2026-01-01" });
    const parsed = JSON.parse(stripComments(config));
    expect(parsed).toEqual({
      name: "my-site",
      main: "node_modules/@typren/adapter-cloudflare/dist/worker.js",
      compatibility_date: "2026-01-01",
      assets: {
        directory: "./out",
        binding: "ASSETS",
        html_handling: "none",
        not_found_handling: "404-page",
        run_worker_first: ["/*", "!/_next/*"],
      },
    });
    expect(parsed.routes).toBeUndefined();
  });

  it("adds a routes entry per domain when given", () => {
    const config = renderWranglerConfig({ name: "my-site", compatibilityDate: "2026-01-01", domains: ["example.com", "www.example.com"] });
    const parsed = JSON.parse(stripComments(config));
    expect(parsed.routes).toEqual([
      { pattern: "example.com", custom_domain: true },
      { pattern: "www.example.com", custom_domain: true },
    ]);
  });

  it("pins the account and writes bare-URL / canonical-host vars when asked", () => {
    const parsed = JSON.parse(
      stripComments(
        renderWranglerConfig({
          name: "my-site",
          compatibilityDate: "2026-01-01",
          accountId: "abf15ad296286bbdffe4acf07b54c39a",
          trailingSlash: false,
          canonicalHost: "www.example.com",
          domains: ["example.com"],
        })
      )
    );
    expect(parsed.account_id).toBe("abf15ad296286bbdffe4acf07b54c39a");
    expect(parsed.vars).toEqual({ TYPREN_TRAILING_SLASH: "false", TYPREN_CANONICAL_HOST: "www.example.com" });
    expect(parsed.routes).toEqual([{ pattern: "example.com", custom_domain: true }]);
  });

  it("writes no vars for the default trailing-slash shape", () => {
    expect(JSON.parse(stripComments(renderWranglerConfig({ name: "my-site", compatibilityDate: "2026-01-01" }))).vars).toBeUndefined();
  });

  it.each([
    [{ accountId: "not-an-account" }, "not a valid Cloudflare account id"],
    [{ canonicalHost: "https://www.example.com" }, "not a valid custom domain"],
  ])("rejects %o", (extra, message) => {
    expect(() => renderWranglerConfig({ name: "my-site", compatibilityDate: "2026-01-01", ...extra })).toThrow(message);
  });

  it("honors a custom assetsDir", () => {
    const config = renderWranglerConfig({ name: "my-site", compatibilityDate: "2026-01-01", assetsDir: "./dist" });
    expect(JSON.parse(stripComments(config)).assets.directory).toBe("./dist");
  });

  it.each(["My-Site", "-leading-hyphen", "trailing-hyphen-", "a".repeat(64), "has_underscore", ""])(
    "rejects an invalid Worker name %j",
    (name) => {
      expect(() => renderWranglerConfig({ name, compatibilityDate: "2026-01-01" })).toThrow(/not a valid Worker name/);
    }
  );

  it("accepts a 63-character name and single-character name", () => {
    expect(() => renderWranglerConfig({ name: "a".repeat(63), compatibilityDate: "2026-01-01" })).not.toThrow();
    expect(() => renderWranglerConfig({ name: "a", compatibilityDate: "2026-01-01" })).not.toThrow();
  });

  it.each(["https://x.com", "x.com/path", "*.x.com", "-x.com", "no-dot"])("rejects an invalid custom domain %j", (domain) => {
    expect(() => renderWranglerConfig({ name: "my-site", compatibilityDate: "2026-01-01", domains: [domain] })).toThrow(
      /not a valid custom domain/
    );
  });

  it("accepts an ordinary hostname", () => {
    expect(() => renderWranglerConfig({ name: "my-site", compatibilityDate: "2026-01-01", domains: ["example.com"] })).not.toThrow();
  });
});
