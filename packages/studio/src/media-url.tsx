"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TyprenStudioHost } from "./types";

const MediaOrigin = createContext<string | undefined>(undefined);

/** The site's origin when `host.previewUrl` is absolute (the studio frames the
 *  site's own dev server), else undefined: a same-origin studio needs no
 *  rewriting. */
export function siteOrigin(host: Pick<TyprenStudioHost, "previewUrl" | "homeSlug">): string | undefined {
  const url = host.previewUrl?.(host.homeSlug ?? "home");
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Content stores root-relative media URLs (`/img/a.webp`). Against another
 *  origin they only resolve when the site's origin is prefixed. Absolute,
 *  protocol-relative, `data:` and `blob:` URLs pass through untouched. */
export function resolveMediaUrl(url: string, origin?: string): string {
  if (!origin || !url.startsWith("/") || url.startsWith("//")) return url;
  return new URL(url, origin).href;
}

export function MediaOriginProvider({ origin, children }: Readonly<{ origin?: string; children: ReactNode }>) {
  return <MediaOrigin.Provider value={origin}>{children}</MediaOrigin.Provider>;
}

/** Resolves a media URL for display against the surrounding studio's site origin. */
export function useMediaUrl(): (url: string) => string {
  const origin = useContext(MediaOrigin);
  return (url) => resolveMediaUrl(url, origin);
}
