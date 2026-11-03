export type { Catalog, Manifest, ManifestEntry, Delta, TrustedKey, ManifestSignature } from "./types";
export { verifyManifestSignature, manifestSigningInput } from "./sign";
export { resolve, interpolate, t, getClosestLocale } from "./locale";
export type {
  AliasEntry,
  AliasMap,
  AliasResolver,
  AliasResolverOptions,
  VueI18nMessagesLike,
  VueI18nMissingHandler,
  I18nextParseMissingKeyHandler,
} from "./aliases";
export {
  parseAliases,
  validateAliases,
  applyAliasCopies,
  createAliasResolver,
  createVueI18nMissingHandler,
  createI18nextParseMissingKeyHandler,
} from "./aliases";
export { canonicalize, hashCatalog } from "./canonicalize";
export { diff, merge, isPlaceholderCompatible } from "./delta";
export { assertNoHtml } from "./no-html";
export type { Purifier } from "./no-html";
