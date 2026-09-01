import fs from "node:fs";
import yaml from "js-yaml";
import type { AuthAction, AuthContext, AuthUser, Policy } from "./auth-adapter";

/** `.typren/access.yml` shape (docs/hosted-platform.md, "The policy file").
 *  `groups` maps a group name to the actions it may perform; `members` maps
 *  an identity (email, matched case-insensitively) or a `"*@domain"`
 *  wildcard default to a group name. */
export interface AccessPolicyFile {
  groups: Record<string, AuthAction[]>;
  members: Record<string, string>;
}

/**
 * File-backed `Policy`: reads the YAML file at `file` and checks the
 * resolved user's group against the requested action. DEFAULT CLOSED — no
 * member entry (exact email, falling back to a `*@domain` wildcard) or no
 * action listed for the matched group means deny, full stop; there is no
 * fallback allow.
 *
 * Read fresh on every call: these files are small and change by git commit
 * (slow), so this trades a stat+read per request for zero cache-invalidation
 * logic. `withPolicy` (auth-adapter.ts) already wraps this in the fail-closed
 * try/catch, so a missing file or malformed YAML denies rather than throwing
 * through to the caller.
 *
 * `file`'s location is the caller's responsibility to keep OUTSIDE whatever
 * the dashboard's ContentAdapter can write (`content/**` and the media dir)
 * — that's what closes the escalation trap (an editor promoting themselves
 * to admin), not anything in here. See docs/hosted-platform.md, "The
 * escalation trap".
 */
export function filePolicy(opts: { file: string }): Policy {
  return {
    authorize(user: AuthUser | null, ctx: AuthContext) {
      if (!user?.email) return false;
      const doc = yaml.load(fs.readFileSync(opts.file, "utf8")) as Partial<AccessPolicyFile> | undefined;
      if (!doc?.groups || !doc.members) return false;

      const email = user.email.toLowerCase();
      const domain = email.slice(email.indexOf("@")); // "" when email has no "@"
      const members = new Map(Object.entries(doc.members).map(([k, v]) => [k.toLowerCase(), v]));
      const groupName = members.get(email) ?? members.get(`*${domain}`);
      const actions = groupName ? doc.groups[groupName] : undefined;
      return actions?.includes(ctx.action) ?? false;
    },
  };
}
