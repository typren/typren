// Apart from git.ts, which spawns processes, so the browser editor can import
// these without pulling in node:child_process.

/** A git failure whose message is a plain-language reason the person saving
 *  or pushing can act on, not git's own text. */
export class GitError extends Error {
  override name = "GitError";
}

export const GIT_NO_BRANCH = "Check out a branch in your site folder to save.";
