import type { SettingsStore } from "../settings";
import { styleCss, type StyleMap } from "../style";

/** The saved Style tokens as the site's stylesheet rule (see `styleCss`):
 *  sanitised, unlayered, `:root:root`. Empty when nothing is saved. `map` is
 *  the site's `studio.style` from `typren.config.json`; without one, the stock
 *  shadcn names. Reads the published settings on every call, like
 *  `resolveSeoConfig`. */
export async function resolveStyleCss(settings: Pick<SettingsStore, "get">, map?: StyleMap, locale?: string): Promise<string> {
  return styleCss((await settings.get(locale)).style, map);
}

/** A server component that renders `resolveStyleCss` as a `<style>`, which
 *  React hoists into `<head>` once however many times it renders. Nothing
 *  when no token is saved. */
export async function TyprenStyle({ store, map, locale }: Readonly<{ store: Pick<SettingsStore, "get">; map?: StyleMap; locale?: string }>) {
  const css = await resolveStyleCss(store, map, locale);
  return css ? (
    <style href="typren-style" precedence="typren">
      {css}
    </style>
  ) : null;
}
