import { describe, expect, it } from "vitest";
import { supabaseAuthAdapter, type SupabaseUser } from "./supabase";

const client = (user: SupabaseUser | null, error: unknown = null) => ({
  auth: { getUser: async () => ({ data: { user }, error }) },
});

describe("supabaseAuthAdapter", () => {
  it("allows a user with an allowlisted app_metadata role", async () => {
    const adapter = supabaseAuthAdapter({
      client: client({ id: "u1", email: "user@example.com", app_metadata: { roles: ["editor"] } }),
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("denies when the role isn't allowlisted", async () => {
    const adapter = supabaseAuthAdapter({
      client: client({ id: "u1", app_metadata: { roles: ["viewer"] } }),
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("treats a Supabase error as unauthenticated", async () => {
    const adapter = supabaseAuthAdapter({
      client: client(null, new Error("invalid token")),
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });

  it("denies when there's no user", async () => {
    const adapter = supabaseAuthAdapter({ client: client(null), allowedRoles: ["editor"] });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });

  it("throws at construction without an allowlist", () => {
    expect(() => supabaseAuthAdapter({ client: client(null) })).toThrow(/requires an allowlist/);
  });

  it("NEVER reads roles from user_metadata, which the end user can write themselves", async () => {
    const adapter = supabaseAuthAdapter({
      client: client({
        id: "u1",
        email: "user@example.com",
        user_metadata: { roles: ["admin"] },
        app_metadata: {},
      }),
      allowedRoles: ["admin"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("accepts a singular app_metadata.role string", async () => {
    const adapter = supabaseAuthAdapter({
      client: client({ id: "u1", app_metadata: { role: "editor" } }),
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("gates admin on adminRoles, denying unmapped admin even with matching allowedRoles", async () => {
    const user = { id: "u1", app_metadata: { roles: ["admin"] } };
    const noAdminCfg = supabaseAuthAdapter({ client: client(user), allowedRoles: ["admin"] });
    expect(await noAdminCfg.authorize({ action: "admin" })).toBe(false);

    const withAdmin = supabaseAuthAdapter({
      client: client(user),
      allowedRoles: ["admin"],
      adminRoles: ["admin"],
    });
    expect(await withAdmin.authorize({ action: "admin" })).toBe(true);
  });

  it("fails closed when getUser throws", async () => {
    const adapter = supabaseAuthAdapter({
      client: {
        auth: {
          getUser: async () => {
            throw new Error("boom");
          },
        },
      },
      allowedRoles: ["editor"],
    });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
    expect(await adapter.getUser!({ action: "read" })).toBeNull();
  });
});
