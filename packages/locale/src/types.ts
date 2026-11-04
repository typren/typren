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

export interface ManifestSignature {
  /** Matches a TrustedKey.kid the app embeds. */
  kid: string;
  /** ECDSA P-256 over SHA-256; the only accepted value. */
  alg: "ES256";
  /** base64url of the raw 64-byte r||s (IEEE P1363) signature WebCrypto emits. */
  sig: string;
}

export type TrustedKey = { kid: string; jwk: JsonWebKey } | { kid: string; spki: string };

/** Per {app,lang} content hash, published alongside each release. */
export interface Manifest {
  v: 1;
  buildVersion: string;
  /** Monotonic per manifest URL. Optional in the type because the manifest is untrusted input the verifier validates. */
  sequence?: number;
  /** ISO 8601. */
  issuedAt?: string;
  /** ISO 8601. */
  expiresAt?: string;
  apps: {
    [app: string]: {
      [lang: string]: ManifestEntry;
    };
  };
  signature?: ManifestSignature;
}

/** Flat dot-path delta between two catalogs. */
export interface Delta {
  changed: Record<string, string>;
  removed: string[];
}
