// Consent-gated third-party tags: one engine, one adapter per vendor. Loaded
// on the page by @typren/core/ui/typren-tags; a default banner is
// @typren/core/ui/consent-banner.
export {
  createConsentStore,
  isStrictConsentRegion,
  consentModeSignals,
  type ConsentCategory,
  type ConsentPrefs,
  type StoredConsent,
  type ConsentStore,
  type ConsentStoreOptions,
} from "./consent";
export {
  createGtmAdapter,
  createGa4Adapter,
  createMetaPixelAdapter,
  createScriptAdapter,
  type TagAdapter,
  type TagCategory,
  type TagProps,
  type TagScript,
  type GtmAdapterOptions,
  type Ga4AdapterOptions,
  type MetaPixelAdapterOptions,
  type ScriptAdapterOptions,
} from "./adapters";
export { createTagEngine, type TagEngine, type TagEngineOptions } from "./engine";
