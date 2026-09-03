// @typren/editor: the editor UI layer of the seam documented in the root
// README: ContentAdapter -> ContentStore -> makeActions(config) -> editor UI
// (here). `TyprenEditorHost.sections` grows it from the v1 Pages-only loop
// into the SDUI admin shell (Media/Collections/Settings) core's `sections.ts`
// anticipates — additive, see `types.ts`'s doc comment. Onboarding stays out
// of scope: core never gave it a `SectionKind`.

export { TyprenEditor, type TyprenEditorProps } from "./typren-editor";
export type { TyprenEditorHost, TyprenEditorSettingsActions } from "./types";

// The core editing-loop pieces, exported individually too: a host composing
// its own layout (rather than the default `TyprenEditor` picker/shell split)
// can reuse them directly.
export { EditorShell } from "./editor-shell";
export { PagesNav } from "./pages-nav";
export { PageList } from "./page-list";
export { BlockList } from "./block-list";
export { DevicePreview } from "./device-preview";
export { FieldForm } from "./field-form";
export { ImagePickerField, type FieldFormMedia } from "./image-picker-field";
export { IconPickerField, type FieldFormIcons } from "./icon-picker-field";
export { MediaGrid } from "./media-grid";

// SDUI section shell pieces, exported individually for the same reason as
// the Pages-loop pieces above.
export { SectionShell } from "./section-shell";
export { SectionNav } from "./section-nav";
export { MediaLibrarySection } from "./media-library";
export { SettingsPanel } from "./settings-panel";
export { CollectionPanel, type CollectionMode } from "./collection-panel";
export { CollectionList, resolveListColumns } from "./collection-list";

// Live-preview iframe bridge: mount `<PreviewBridge/>` in the host's preview
// route. The underlying listener logic is @typren/core's vanilla bridge (it
// must stay framework-free); `initPreviewBridge` is re-exported for a host
// that wants to mount it without React.
export { PreviewBridge } from "./preview-bridge";
export { initPreviewBridge } from "@typren/core/ui/preview-bridge.vanilla";

export { CmsIntlProvider, useT } from "./intl";
