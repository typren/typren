// @typren/studio: the studio UI layer of the seam documented in the root
// README: ContentAdapter -> ContentStore -> makeActions(config) -> studio UI
// (here). The shell is spec'd in docs/editor-v3.md. Onboarding stays out of
// scope: core never gave it a `SectionKind`.

export { TyprenStudio, type TyprenStudioProps } from "./typren-studio";
export type { TemplatesView } from "./site-rail";
export type { TyprenStudioHost, TyprenStudioSettingsActions } from "./types";

// The pieces the shell is built from, exported for a host composing its own.
export { BlockList } from "./block-list";
export { DevicePreview, DeviceToggle, type Device } from "./device-preview";
export { FieldForm } from "./field-form";
export { ImagePickerField, type FieldFormMedia } from "./image-picker-field";
export { IconPickerField, type FieldFormIcons } from "./icon-picker-field";
export { MediaGrid } from "./media-grid";

export { MediaLibrarySection } from "./media-library";
export { SettingsPanel } from "./settings-panel";
export { StylePanel } from "./style-panel";
export { CollectionPanel, type CollectionMode } from "./collection-panel";
export { CollectionList, resolveListColumns } from "./collection-list";

// Live-preview iframe bridge: mount `<PreviewBridge/>` in the host's preview
// route. The underlying listener logic is @typren/core's vanilla bridge (it
// must stay framework-free); `initPreviewBridge` is re-exported for a host
// that wants to mount it without React.
export { PreviewBridge } from "./preview-bridge";
export { initPreviewBridge } from "@typren/core/ui/preview-bridge.vanilla";

export { CmsIntlProvider, useT } from "./intl";
