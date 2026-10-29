/** The longest slug segment or media name the editor offers. */
const NAME_MAX = 64;
const MEDIA_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** Why `segment` can't be a new slug segment beside `taken`, in the style of
 *  `nameError`; null when it can. The content adapter enforces its own slug
 *  rule regardless; this only explains it before the round trip. */
export function slugError(segment: string, taken: string[]): string | null {
  if (!segment) return "Enter a slug.";
  if (segment.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
  if (/[A-Z]/.test(segment)) return "Use lowercase letters.";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(segment))
    return segment.startsWith("-") ? "Start with a letter or number." : "Use letters, numbers and - only.";
  if (taken.includes(segment)) return "That slug is already used here.";
  return null;
}

/** Why `name` can't be a media asset or folder name beside `taken`, or null:
 *  safe in a URL as typed, and within what the media adapter accepts. `ext`
 *  is an asset's extension, which the name may end with but never changes. */
export function nameError(name: string, taken: string[], ext = ""): string | null {
  const base = ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  if (!base) return "Enter a name.";
  if (base.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
  if (/[A-Z]/.test(base)) return "Use lowercase letters.";
  if (!MEDIA_NAME.test(base)) return /^[-_]/.test(base) ? "Start with a letter or number." : "Use letters, numbers, - and _ only.";
  if (taken.includes(base + ext)) return "That name is already used here.";
  return null;
}

/** The editor's group for templates its code ships. Reserved at the top
 *  level, so no saved folder can be mistaken for it. */
export const BUILT_IN_FOLDER = "built-in";

/** Why `folder` can't be a library folder path, or null. Each segment
 *  follows the media folder name rule (`nameError`), so "..", "/" runs and
 *  other traversal shapes never pass. */
export function libraryFolderError(folder: string): string | null {
  if (typeof folder !== "string" || !folder) return "Enter a folder.";
  if (folder.split("/")[0] === BUILT_IN_FOLDER) return `"${BUILT_IN_FOLDER}" is reserved.`;
  for (const seg of folder.split("/")) {
    const error = nameError(seg, []);
    if (error) return error;
  }
  return null;
}
