import { studioSiteConfig, type CmsConfig, type StudioManifest } from "@typren/core";
import { localAuth } from "@typren/core/auth/local";

export type { StudioManifest };

export function readManifest(raw: string | undefined = process.env.TYPREN_STUDIO): StudioManifest {
  if (!raw) throw new Error("typren studio: TYPREN_STUDIO is not set. Start the studio with `typren studio --local` from the site's root.");
  return JSON.parse(raw) as StudioManifest;
}

/** The site's config behind localAuth: the studio runs `next dev -H
 *  127.0.0.1` (see `typren studio`), which is exactly the bind it requires. */
export function studioConfig(manifest: StudioManifest): CmsConfig {
  return studioSiteConfig(manifest, localAuth());
}
