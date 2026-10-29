/** Slug of the site-wide doc `typren init` scaffolds beside the pages
 *  (`content/site.md`). The store never lists it as a page, slice array or
 *  not. Its `nav` and `cta` are the site's header menu. */
export const SITE_SLUG = "site";

/** One header menu link in the site doc's `nav`, or its `cta`. Keys the
 *  editor doesn't know round-trip untouched. */
export type NavItem = { label: string; href: string; external?: boolean; children?: NavItem[] } & Record<string, unknown>;

const HREF_HINT = "Use a site path like /about or a full https:// address.";

/** Why `href` can't be a menu link, or null when it can: a site path
 *  ("/about"), a fragment ("#", "#team") or an absolute http(s) URL. Every
 *  other scheme is refused, `javascript:` foremost, since a site renders
 *  these straight into `<a href>`. */
export function navHrefError(href: string): string | null {
  if (!href) return "Enter a link.";
  // Browsers strip tabs and newlines inside a scheme ("java\tscript:"), and
  // read a backslash as a slash ("/\evil.com" is protocol-relative).
  if (/[\s\\]/.test(href)) return "Links can't contain spaces or backslashes.";
  if (href.startsWith("#")) return null;
  if (href.startsWith("/")) return href.startsWith("//") ? "Start a site path with a single /." : null;
  try {
    const { protocol } = new URL(href);
    return protocol === "http:" || protocol === "https:" ? null : HREF_HINT;
  } catch {
    return HREF_HINT;
  }
}

/** How deeply submenus may nest. Header menus use one or two levels; the cap
 *  keeps the recursive walks here from overflowing the stack on a hostile or
 *  broken site doc. */
const MAX_NAV_DEPTH = 8;

const tooDeep = () => new Error(`typren: navigation menus nest at most ${MAX_NAV_DEPTH} levels deep.`);

/** Throws on the first unsafe href in a site doc's `nav` (children
 *  included) or `cta`, or on submenus nested deeper than `MAX_NAV_DEPTH`.
 *  The store runs it on every draft of the site doc, so no caller can write
 *  a link the editor would refuse. Items of another shape are left alone:
 *  they are not menu links. */
export function assertSafeNav(meta: Record<string, unknown>): void {
  const visit = (item: unknown, depth: number) => {
    if (!item || typeof item !== "object") return;
    if (depth > MAX_NAV_DEPTH) throw tooDeep();
    const { href, children } = item as Record<string, unknown>;
    if (href !== undefined) {
      const problem = typeof href === "string" ? navHrefError(href) : "Links must be text.";
      if (problem) throw new Error(`typren: navigation link ${JSON.stringify(href)} refused. ${problem}`);
    }
    if (Array.isArray(children)) for (const c of children) visit(c, depth + 1);
  };
  if (Array.isArray(meta.nav)) for (const x of meta.nav) visit(x, 1);
  visit(meta.cta, 1);
}

/** The site doc's menu, or null when it has none: a site whose header is
 *  built in its own code. Entries that aren't items are left out. */
export function readMenu(meta: Record<string, unknown>): { nav: NavItem[]; cta?: NavItem } | null {
  if (!Array.isArray(meta.nav)) return null;
  const isItem = (x: unknown): x is NavItem => !!x && typeof x === "object" && !Array.isArray(x);
  return { nav: meta.nav.filter(isItem), cta: isItem(meta.cta) ? meta.cta : undefined };
}

/** The site path an internal menu href points at, for matching a page:
 *  no query, fragment or trailing slash. Null for an external or "#" link. */
function navTarget(item: Pick<NavItem, "href" | "external">): string | null {
  if (item.external === true || typeof item.href !== "string" || !/^\/(?!\/)/.test(item.href)) return null;
  return item.href.split(/[?#]/)[0]!.replace(/(.)\/+$/, "$1");
}

/** Whether any menu item, submenus included, links to `path`. */
export const linksTo = (nav: NavItem[], path: string) =>
  nav.some((x) => navTarget(x) === path || (x.children ?? []).some((c) => navTarget(c) === path));

/** `nav` without the items linking to `path`; a removed item's submenu
 *  moves up into its place, so unlinking a page never drops other links. */
export function unlink(nav: NavItem[], path: string): NavItem[] {
  const withChildren = (item: NavItem, children: NavItem[]): NavItem => {
    const { children: _drop, ...rest } = item;
    void _drop;
    return (children.length ? { ...rest, children } : rest) as NavItem;
  };
  // `depth` is the list's level in the input, promoted or not, so it bounds the recursion.
  const drop = (list: NavItem[], depth: number): NavItem[] => {
    if (depth > MAX_NAV_DEPTH) throw tooDeep();
    return list.flatMap((x) =>
      navTarget(x) === path ? drop(x.children ?? [], depth + 1) : [x.children ? withChildren(x, drop(x.children, depth + 1)) : x]
    );
  };
  return drop(nav, 1);
}

/** `nav` with every item linking to `from`, submenus included, pointed at
 *  `to` instead, keeping its query, fragment or trailing slash. */
export function relink(nav: NavItem[], from: string, to: string): NavItem[] {
  const move = (list: NavItem[], depth: number): NavItem[] => {
    if (depth > MAX_NAV_DEPTH) throw tooDeep();
    return list.map((x) => ({
      ...x,
      ...(navTarget(x) === from && { href: to + x.href.slice(from.length) }),
      ...(x.children && { children: move(x.children, depth + 1) }),
    }));
  };
  return move(nav, 1);
}
