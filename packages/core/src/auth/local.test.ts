import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { localAuth as rawLocalAuth } from "./local";

// Outside a Next request the default forwarded-header check fails closed, so
// tests that aren't about it opt out; the forwarding tests use the default.
const localAuth = (opts: Parameters<typeof rawLocalAuth>[0] = {}) =>
  rawLocalAuth({ hasForwardedHeaders: async () => false, ...opts });

// What next's start-server sets after `next dev -H 127.0.0.1`. Every test
// starts loopback-bound; the bind tests override it.
beforeEach(() => vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000"));
afterEach(() => vi.unstubAllEnvs());

describe("localAuth", () => {
  // Regression: a same-host proxy/tunnel rewrites Host to loopback, so the
  // bind and Host checks pass for an internet visitor. Next fills
  // x-forwarded-* itself, so only the values can tell.
  const nextHeaders = async (init: Record<string, string>) => {
    vi.doMock("next/headers", () => ({ headers: async () => new Headers(init) }));
    vi.resetModules();
    return (await import("./local")).localAuth();
  };
  const browser = {
    host: "localhost:3000",
    "x-forwarded-host": "localhost:3000",
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-proto": "http",
  };

  it("allows a plain browser carrying the x-forwarded-* headers Next itself adds", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const xff of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.1, ::1"]) {
      const adapter = await nextHeaders({ ...browser, "x-forwarded-for": xff });
      expect(await adapter.authorize({ action: "saveDraft" }), xff).toBe(true);
    }
    vi.doUnmock("next/headers");
  });

  it("denies headers that show a forwarder", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const cases: Record<string, string>[] = [
      { "x-forwarded-for": "203.0.113.9" },
      { "x-forwarded-for": "127.0.0.1, 203.0.113.9" },
      { "x-forwarded-for": "not an ip" },
      { "x-forwarded-host": "app.example.com" },
      { "x-forwarded-host": "localhost:3000, app.example.com" },
      { forwarded: "for=127.0.0.1" },
      { "x-real-ip": "127.0.0.1" },
    ];
    for (const extra of cases) {
      const adapter = await nextHeaders({ ...browser, ...extra });
      expect(await adapter.authorize({ action: "saveDraft" }), JSON.stringify(extra)).toBe(false);
      expect(await adapter.getUser!({ action: "read" }), JSON.stringify(extra)).toBeNull();
    }
    vi.doUnmock("next/headers");
  });

  it("allows plain loopback with no forwarding headers", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const adapter = await nextHeaders({ host: "localhost:3000" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
    vi.doUnmock("next/headers");
  });

  it("denies when hasForwardedHeaders reports true or throws", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const getHost = async () => "localhost:3000";
    expect(await localAuth({ getHost, hasForwardedHeaders: async () => true }).authorize({ action: "saveDraft" })).toBe(false);
    const throws = async () => { throw new Error("boom"); };
    expect(await localAuth({ getHost, hasForwardedHeaders: throws }).authorize({ action: "saveDraft" })).toBe(false);
  });

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

  it("allows a server bound to 127.0.0.1", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "https://127.0.0.1:3000");
    const adapter = localAuth({ getHost: async () => "localhost:3000" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  // Next reports an all-interfaces `-H ::` bind as "[::1]", the same origin an
  // explicit `-H ::1` gets, so "[::1]" can't prove a loopback-only listener.
  it("denies a server whose origin is [::1]", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://[::1]:3000");
    const adapter = localAuth({ getHost: async () => "localhost:3000" });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
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

  // Non-Next hosts (Astro) prove the bind themselves; the Next env var is
  // then irrelevant either way.
  describe("isBoundToLoopback option", () => {
    it("allows when the host reports a loopback bind, even without Next's env var", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "");
      const adapter = localAuth({ isBoundToLoopback: () => true, getHost: async () => "localhost:4321" });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
      expect(await adapter.getUser!({ action: "read" })).toEqual({ id: "local-dev", name: "Local dev" });
    });

    it("denies when the host reports no loopback bind, even if Next's env var says loopback", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const adapter = localAuth({ isBoundToLoopback: () => false, getHost: async () => "localhost:4321" });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
    });

    it("denies a truthy non-boolean, so a stray address string can't pass as proof", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const adapter = localAuth({
        isBoundToLoopback: (() => "0.0.0.0") as unknown as () => boolean,
        getHost: async () => "localhost",
      });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
    });

    it("denies a non-loopback Host on a loopback bind", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const adapter = localAuth({ isBoundToLoopback: () => true, getHost: async () => "evil.example:4321" });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
    });

    it("denies in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const adapter = localAuth({ isBoundToLoopback: () => true, getHost: async () => "localhost" });
      expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
    });

    it("denies rather than throws when a check throws", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const boom = () => {
        throw new Error("boom");
      };
      for (const adapter of [
        localAuth({ isBoundToLoopback: boom, getHost: async () => "localhost" }),
        localAuth({ isBoundToLoopback: () => true, getHost: async () => boom() }),
        localAuth({ predicate: boom, isBoundToLoopback: () => true, getHost: async () => "localhost" }),
      ]) {
        expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
        expect(await adapter.getUser!({ action: "read" })).toBeNull();
      }
    });
  });
});
