import { describe, expect, it } from "vitest";
import { nextAuthAdapter } from "./next-auth";

const session = (overrides: { email?: string; roles?: string[] } = {}) => ({
  user: { id: "u1", email: overrides.email ?? "user@example.com", name: "User", roles: overrides.roles },
});

describe("nextAuthAdapter", () => {
  // Regression: without this throw, a bare `nextAuthAdapter({ auth })` authorized
  // ANY signed-in user (the old "DEFAULT-OPEN CAVEAT"), which is almost never the
  // intended policy for an editor.
  it("throws at construction without an allowlist", () => {
    expect(() => nextAuthAdapter({ auth: async () => null })).toThrow(/requires an allowlist/);
  });

  it("does not throw when allowedEmails is set", () => {
    expect(() => nextAuthAdapter({ auth: async () => null, allowedEmails: ["user@example.com"] })).not.toThrow();
  });

  it("does not throw when allowedRoles is set", () => {
    expect(() => nextAuthAdapter({ auth: async () => null, allowedRoles: ["editor"] })).not.toThrow();
  });

  it("allows a session whose email is allowlisted", async () => {
    const adapter = nextAuthAdapter({ auth: async () => session(), allowedEmails: ["user@example.com"] });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("denies when the email isn't allowlisted", async () => {
    const adapter = nextAuthAdapter({ auth: async () => session(), allowedEmails: ["someone-else@example.com"] });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("gates admin on adminRoles, denying unmapped admin even with matching allowedRoles", async () => {
    const adapter = nextAuthAdapter({
      auth: async () => session({ roles: ["admin"] }),
      allowedRoles: ["admin"],
    });
    expect(await adapter.authorize({ action: "admin" })).toBe(false);

    const withAdmin = nextAuthAdapter({
      auth: async () => session({ roles: ["admin"] }),
      allowedRoles: ["admin"],
      adminRoles: ["admin"],
    });
    expect(await withAdmin.authorize({ action: "admin" })).toBe(true);
  });

  it("fails closed when auth() throws", async () => {
    const adapter = nextAuthAdapter({
      auth: async () => {
        throw new Error("boom");
      },
      allowedEmails: ["user@example.com"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });
});
