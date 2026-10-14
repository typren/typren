import { describe, expect, it } from "vitest";
import { betterAuthAdapter } from "./better-auth";

const session = (overrides: { role?: string | null } = {}) => ({
  user: { id: "u1", email: "user@example.com", name: "User", role: overrides.role },
});

describe("betterAuthAdapter", () => {
  it("allows a session whose email is allowlisted", async () => {
    const adapter = betterAuthAdapter({
      getSession: async () => session(),
      allowedEmails: ["user@example.com"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("denies when the email isn't allowlisted", async () => {
    const adapter = betterAuthAdapter({
      getSession: async () => session(),
      allowedEmails: ["someone-else@example.com"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("denies unauthenticated (no session)", async () => {
    const adapter = betterAuthAdapter({ getSession: async () => null, allowedEmails: ["user@example.com"] });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });

  it("throws at construction without an allowlist", () => {
    expect(() => betterAuthAdapter({ getSession: async () => null })).toThrow(/requires an allowlist/);
  });

  it("splits a comma-separated role string into roles", async () => {
    const adapter = betterAuthAdapter({
      getSession: async () => session({ role: "editor, admin" }),
      allowedRoles: ["admin"],
    });
    const user = await adapter.getUser!({ action: "read" });
    expect(user?.roles).toEqual(["editor", "admin"]);
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("gates admin on adminRoles, denying unmapped admin even with matching allowedRoles", async () => {
    const adapter = betterAuthAdapter({
      getSession: async () => session({ role: "admin" }),
      allowedRoles: ["admin"],
    });
    expect(await adapter.authorize({ action: "admin" })).toBe(false);

    const withAdmin = betterAuthAdapter({
      getSession: async () => session({ role: "admin" }),
      allowedRoles: ["admin"],
      adminRoles: ["admin"],
    });
    expect(await withAdmin.authorize({ action: "admin" })).toBe(true);
  });

  it("fails closed when getSession throws", async () => {
    const adapter = betterAuthAdapter({
      getSession: async () => {
        throw new Error("boom");
      },
      allowedEmails: ["user@example.com"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });

  it("supports a custom rolesFrom extractor", async () => {
    const adapter = betterAuthAdapter({
      getSession: async () => ({ user: { id: "u1", email: "user@example.com" } }) as never,
      rolesFrom: () => ["custom-role"],
      allowedRoles: ["custom-role"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });
});
