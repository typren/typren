import { describe, expect, it } from "vitest";
import { checkAllowlist } from "./allowlist";

const user = (overrides: { email?: string; roles?: string[] } = {}) => ({
  id: "u1",
  email: overrides.email ?? "user@example.com",
  roles: overrides.roles,
});

describe("checkAllowlist", () => {
  it("is default-open with no allowlists", () => {
    expect(checkAllowlist(user(), { action: "read" }, {})).toBe(true);
  });

  it("denies an email not on allowedEmails (case-insensitive match otherwise)", () => {
    expect(checkAllowlist(user(), { action: "read" }, { allowedEmails: ["USER@example.com"] })).toBe(true);
    expect(checkAllowlist(user(), { action: "read" }, { allowedEmails: ["nope@example.com"] })).toBe(false);
  });

  it("denies a role not on allowedRoles", () => {
    expect(checkAllowlist(user({ roles: ["editor"] }), { action: "read" }, { allowedRoles: ["editor"] })).toBe(
      true
    );
    expect(checkAllowlist(user({ roles: ["viewer"] }), { action: "read" }, { allowedRoles: ["editor"] })).toBe(
      false
    );
  });

  it("denies an email containing non-ASCII characters instead of locale-lowercasing it", () => {
    // Turkish dotless/dotted i is the classic locale-sensitive lowercasing
    // trap; the allowlist must never depend on the host's locale.
    expect(
      checkAllowlist(user({ email: "USER@EXAMPLE.COM" }), { action: "read" }, { allowedEmails: ["user@example.com"] })
    ).toBe(true);
    expect(
      checkAllowlist(
        user({ email: "üser@example.com" }),
        { action: "read" },
        { allowedEmails: ["üser@example.com"] }
      )
    ).toBe(false);
  });

  it("denies admin unless adminRoles is configured and intersects", () => {
    expect(checkAllowlist(user({ roles: ["admin"] }), { action: "admin" }, {})).toBe(false);
    expect(
      checkAllowlist(user({ roles: ["admin"] }), { action: "admin" }, { adminRoles: ["editor"] })
    ).toBe(false);
    expect(
      checkAllowlist(user({ roles: ["admin"] }), { action: "admin" }, { adminRoles: ["admin"] })
    ).toBe(true);
  });
});
