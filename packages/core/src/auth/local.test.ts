import { describe, expect, it, afterEach } from "vitest";
import { localAuth } from "./local";

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

describe("localAuth", () => {
  // Regression: a bare NODE_ENV==="development" check is not a network
  // boundary -- a dev server bound to 0.0.0.0 (containers/VMs do this by
  // default) would expose unauthenticated file writes to anything on the LAN.
  // Host must ALSO resolve to loopback.
  it("denies a non-loopback Host even when NODE_ENV is development", async () => {
    process.env.NODE_ENV = "development";
    const adapter = localAuth({ getHost: async () => "example.com" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });

  it("allows localhost, 127.0.0.1, bracketed [::1], and *.localhost, each with a port", async () => {
    process.env.NODE_ENV = "development";
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "tenant.localhost:3000"]) {
      const adapter = localAuth({ getHost: async () => host });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
    }
  });

  it("denies when getHost resolves to null (e.g. next/headers unavailable)", async () => {
    process.env.NODE_ENV = "development";
    const adapter = localAuth({ getHost: async () => null });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("still refuses in production regardless of Host, unless allowInProduction is set", async () => {
    process.env.NODE_ENV = "production";
    const adapter = localAuth({ getHost: async () => "localhost" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);

    // allowInProduction only lifts the NODE_ENV gate; the default predicate
    // still checks NODE_ENV==="development" itself, so a host overriding one
    // overrides the other too.
    const allowed = localAuth({
      getHost: async () => "localhost",
      allowInProduction: true,
      predicate: () => true,
    });
    expect(await allowed.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("still honors a custom predicate on top of the Host check", async () => {
    process.env.NODE_ENV = "development";
    const adapter = localAuth({ predicate: () => false, getHost: async () => "localhost" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });
});
