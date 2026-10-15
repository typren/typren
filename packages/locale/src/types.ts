/**
 * Nested JSON catalog. Leaves are plain strings, which may contain flat
 * single-brace `{var}` placeholders. No arrays, no plurals. Keep the
 * shape flat/simple so a consuming app's own render engine stays in sync
 * with what this package can express.
 */
export interface Catalog {
  [key: string]: string | Catalog;
}

export interface ManifestEntry {
  hash: string;
  /**
   * Prior release hash -> hash the OTA client's additive merge of that release's precomputed delta
   * must produce. Lives in the manifest so a delta file can never vouch for its own content.
   */
  deltas?: Record<string, string>;
}

/** Per {app,lang} content hash, published alongside each release. */
export interface Manifest {
  v: 1;
  buildVersion: string;
  apps: {
    [app: string]: {
      [lang: string]: ManifestEntry;
    };
  };
}

/** Flat dot-path delta between two catalogs. */
export interface Delta {
  changed: Record<string, string>;
  removed: string[];
}
