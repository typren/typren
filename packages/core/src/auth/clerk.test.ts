import { describe, expect, it, vi, beforeEach } from "vitest";

// clerk.ts imports `auth`/`currentUser` directly (they're global request-scoped
// helpers in real Clerk, not injected like next-auth's `auth()`), so the peer
// module itself is mocked rather than an option passed to the adapter.
const state: {
  userId: string | null;
  sessionClaims: { org_role?: string } | null;
  user: { id: string; primaryEmailAddress: { emailAddress: string; verification: { status: string | null } | null } | null; fullName: string | null } | null;
} = { userId: null, sessionClaims: null, user: null };

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.userId, sessionClaims: state.sessionClaims }),
  currentUser: async () => state.user,
}));

const { clerkAuthAdapter } = await import("./clerk");

const verifiedEmail = (emailAddress: string) => ({ emailAddress, verification: { status: "verified" } });
const unverifiedEmail = (emailAddress: string) => ({ emailAddress, verification: { status: "unverified" } });

beforeEach(() => {
  state.userId = "user_1";
  state.sessionClaims = null;
  state.user = { id: "user_1", primaryEmailAddress: verifiedEmail("user@example.com"), fullName: "User" };
});

describe("clerkAuthAdapter", () => {
  // Regression: with no allowlist option at all, construction used to succeed
  // and `authorize()` granted any signed-in Clerk user every content-write action.
  it("throws at construction without an allowlist", () => {
    expect(() => clerkAuthAdapter()).toThrow(/requires an allowlist/);
    expect(() => clerkAuthAdapter({})).toThrow(/requires an allowlist/);
  });

  it("allowedUserIds alone counts as an allowlist", () => {
    expect(() => clerkAuthAdapter({ allowedUserIds: ["user_1"] })).not.toThrow();
  });

  it("allows a signed-in user when allowedUserIds includes their id", async () => {
    const adapter = clerkAuthAdapter({ allowedUserIds: ["user_1"] });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("denies when allowedUserIds doesn't include the signed-in id", async () => {
    const adapter = clerkAuthAdapter({ allowedUserIds: ["someone-else"] });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("allows a verified primary email on the allowlist", async () => {
    const adapter = clerkAuthAdapter({ allowedEmails: ["user@example.com"] });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(true);
  });

  it("denies an unverified primary email even if it's on the allowlist", async () => {
    state.user!.primaryEmailAddress = unverifiedEmail("user@example.com");
    const adapter = clerkAuthAdapter({ allowedEmails: ["user@example.com"] });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
    expect((await adapter.getUser!({ action: "read" }))?.email).toBeUndefined();
  });

  it("denies when the verified email isn't on the allowlist", async () => {
    const adapter = clerkAuthAdapter({ allowedEmails: ["someone-else@example.com"] });
    expect(await adapter.authorize({ action: "saveDraft" })).toBe(false);
  });

  it("gates admin on adminRoles, denying unmapped admin even with matching allowedRoles", async () => {
    state.sessionClaims = { org_role: "org:admin" };
    const adapter = clerkAuthAdapter({ allowedRoles: ["org:admin"] });
    expect(await adapter.authorize({ action: "admin" })).toBe(false);

    const withAdmin = clerkAuthAdapter({ allowedRoles: ["org:admin"], adminRoles: ["org:admin"] });
    expect(await withAdmin.authorize({ action: "admin" })).toBe(true);
  });

  it("denies unauthenticated (no userId)", async () => {
    state.userId = null;
    const adapter = clerkAuthAdapter({ allowedEmails: ["user@example.com"] });
    expect(await adapter.authorize({ action: "read" })).toBe(false);
  });
});
