import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withPolicy } from "./auth-adapter";
import { filePolicy } from "./file-policy";
import type { AuthAdapter, AuthUser } from "./auth-adapter";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typren-policy-"));
  file = path.join(dir, "access.yml");
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ACCESS_YML = `
groups:
  admin: [admin, publish, saveDraft, createPage, deletePage, uploadMedia, deleteMedia]
  editor: [publish, saveDraft, createPage, uploadMedia]
  writer: [saveDraft]
members:
  sarah@acme.com: editor
  "*@acme.com": writer
`;

const user = (email?: string): AuthUser | null => (email ? { id: email, email } : null);

describe("filePolicy", () => {
  beforeEach(() => fs.writeFileSync(file, ACCESS_YML));

  it("allows an action explicitly listed for the member's exact-match group", async () => {
    const policy = filePolicy({ file });
    expect(await policy.authorize(user("sarah@acme.com"), { action: "publish" })).toBe(true);
  });

  it("denies an action not listed for the member's group", async () => {
    const policy = filePolicy({ file });
    expect(await policy.authorize(user("sarah@acme.com"), { action: "deleteMedia" })).toBe(false);
  });

  it("falls back to the domain wildcard when no exact member entry exists", async () => {
    const policy = filePolicy({ file });
    expect(await policy.authorize(user("random@acme.com"), { action: "saveDraft" })).toBe(true);
    // writer's list has no "publish"/"deletePage" etc.
    expect(await policy.authorize(user("random@acme.com"), { action: "publish" })).toBe(false);
  });

  it("matches emails and member keys case-insensitively", async () => {
    const policy = filePolicy({ file });
    expect(await policy.authorize(user("Sarah@ACME.com"), { action: "publish" })).toBe(true);
  });

  it("is DEFAULT CLOSED: no matching member (exact or wildcard) denies", async () => {
    const policy = filePolicy({ file });
    expect(await policy.authorize(user("nobody@elsewhere.com"), { action: "saveDraft" })).toBe(false);
  });

  it("denies a user with no email (nothing to match against)", async () => {
    const policy = filePolicy({ file });
    expect(await policy.authorize(user(undefined), { action: "read" })).toBe(false);
    expect(await policy.authorize(null, { action: "read" })).toBe(false);
  });

  it("propagates a read error on a missing file (withPolicy's try/catch is what fails it closed)", () => {
    const policy = filePolicy({ file: path.join(dir, "nope.yml") });
    expect(() => policy.authorize(user("sarah@acme.com"), { action: "read" })).toThrow();
  });
});

describe("withPolicy", () => {
  beforeEach(() => fs.writeFileSync(file, ACCESS_YML));

  it("composes an identity adapter's getUser with the policy's authorize", async () => {
    const identity: AuthAdapter = {
      getUser: async () => user("sarah@acme.com"),
      authorize: async () => {
        throw new Error("identity.authorize must never be called — the policy is authoritative");
      },
    };
    const auth = withPolicy(identity, filePolicy({ file }));
    expect(await auth.authorize({ action: "publish" })).toBe(true);
    expect(await auth.authorize({ action: "deleteMedia" })).toBe(false);
  });

  it("delegates getUser to the identity adapter", async () => {
    const identity: AuthAdapter = { getUser: async () => user("sarah@acme.com"), authorize: async () => true };
    const auth = withPolicy(identity, filePolicy({ file }));
    expect(await auth.getUser?.({ action: "read" })).toEqual(user("sarah@acme.com"));
  });

  it("fails closed when the identity adapter has no getUser", async () => {
    const identity: AuthAdapter = { authorize: async () => true };
    const auth = withPolicy(identity, filePolicy({ file }));
    expect(await auth.authorize({ action: "read" })).toBe(false);
  });

  it("fails closed when getUser throws", async () => {
    const identity: AuthAdapter = {
      getUser: async () => {
        throw new Error("session lookup failed");
      },
      authorize: async () => true,
    };
    const auth = withPolicy(identity, filePolicy({ file }));
    expect(await auth.authorize({ action: "read" })).toBe(false);
  });

  it("fails closed when the policy file is missing or malformed", async () => {
    const identity: AuthAdapter = { getUser: async () => user("sarah@acme.com"), authorize: async () => true };

    const missing = withPolicy(identity, filePolicy({ file: path.join(dir, "nope.yml") }));
    expect(await missing.authorize({ action: "read" })).toBe(false);

    fs.writeFileSync(file, "not: [valid, yaml");
    const malformed = withPolicy(identity, filePolicy({ file }));
    expect(await malformed.authorize({ action: "read" })).toBe(false);
  });
});
