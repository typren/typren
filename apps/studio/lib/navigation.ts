import type { PageInfo } from "@typren/core";

export const HOME = "home";

/** A page's studio URL; the site level is "/". */
export const pathFor = (slug: string | null) => (slug ? `/pages/${slug}` : "/");

/** The listed page a studio path previews, or null. Anywhere but a page URL
 *  previews home, as the server does. */
export function pageAt(pathname: string, pages: PageInfo[], homeSlug = HOME): string | null {
  const slug = pathname.startsWith("/pages/") ? decodeURIComponent(pathname.slice("/pages/".length)) : homeSlug;
  return pages.some((p) => p.slug === slug) ? slug : null;
}

/**
 * Follows a page pick. A listed page only changes history: a server
 * navigation would remount the whole studio, since the catch-all page is
 * keyed by its params. A page not listed yet (just created) or none (just
 * deleted) needs the server's fresh page list, so only those navigate for
 * real. `replace` is for moves the preview frame made itself, which already
 * added their own history entry. `edit` opens the page in edit mode.
 */
export function navigatePage(
  next: string | null,
  pages: PageInfo[],
  router: { push: (href: string) => void },
  replace = false,
  edit = false
): void {
  const href = `${pathFor(next)}${edit && next ? "?edit" : ""}`;
  if (!next || !pages.some((p) => p.slug === next)) return router.push(href);
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}
