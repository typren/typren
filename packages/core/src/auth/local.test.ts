import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { localAuth } from "./local";

// What next's start-server sets after `next dev -H 127.0.0.1`. Every test
// starts loopback-bound; the bind tests override it.
beforeEach(() => vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000"));
afterEach(() => vi.unstubAllEnvs());

describe("localAuth", () => {
  // Regression: the Host header is client-chosen, so a LAN client could reach
  // a dev server bound to all interfaces and send `Host: localhost`. The
  // server's own bind address is the boundary; a spoofed Host must not pass.
  it("denies a loopback Host when the server is not bound to loopback", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // `next dev` with no -H (all interfaces) and `-H localhost` both report
    // "localhost", so it can't prove a loopback bind.
    for (const origin of ["http://localhost:3000", "http://192.168.1.23:3000", "", "not a url"]) {
      vi.stubEnv("__NEXT_PRIVATE_ORIGIN", origin);
      const adapter = localAuth({ getHost: async () => "localhost:3000" });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
      expect(await adapter.getUser!({ action: "read" })).toBeNull();
    }
  });

  it("allows a server bound to 127.0.0.1 or ::1", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const origin of ["http://127.0.0.1:3000", "https://[::1]:3000"]) {
      vi.stubEnv("__NEXT_PRIVATE_ORIGIN", origin);
      const adapter = localAuth({ getHost: async () => "localhost:3000" });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
    }
  });

  // A DNS-rebinding page reaches a loopback-bound server with the attacker's
  // hostname in Host; the Host check still narrows access.
  it("denies a non-loopback Host even when bound to loopback", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const adapter = localAuth({ getHost: async () => "example.com" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });

  it("allows localhost, 127.0.0.1, bracketed [::1], and *.localhost, each with a port", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "tenant.localhost:3000"]) {
      const adapter = localAuth({ getHost: async () => host });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
    }
  });

  it("denies when getHost resolves to null (e.g. next/headers unavailable)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const adapter = localAuth({ getHost: async () => null });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("still refuses in production regardless of Host, unless allowInProduction is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const adapter = localAuth({ getHost: async () => "localhost" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);

    // allowInProduction only lifts the NODE_ENV gate; the default predicate
    // still checks NODE_ENV==="development" itself, so a host overriding one
    // overrides the other too. The loopback bind is required regardless.
    const allowed = localAuth({
      getHost: async () => "localhost",
      allowInProduction: true,
      predicate: () => true,
    });
    expect(await allowed.authorize({ action: "saveDraft" })).toBe(true);
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://localhost:3000");
    expect(await allowed.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("still honors a custom predicate on top of the Host check", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const adapter = localAuth({ predicate: () => false, getHost: async () => "localhost" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });
});
