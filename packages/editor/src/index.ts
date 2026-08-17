// @typren/editor — the editor UI layer of the seam documented in the root
// README: ContentAdapter -> ContentStore -> makeActions(config) -> editor UI
// (here). v1 scope is the Pages editing loop only;
// settings/media-library/collections/onboarding sections aren't built yet.

export { TyprenEditor, type TyprenEditorProps } from "./typren-editor";
export type { TyprenEditorHost } from "./types";

// The core editing-loop pieces, exported individually too — a host composing
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

// Live-preview iframe bridge — mount `<PreviewBridge/>` in the host's preview
// route. The underlying listener logic is @typren/core's vanilla bridge (it
// must stay framework-free); `initPreviewBridge` is re-exported for a host
// that wants to mount it without React.
export { PreviewBridge } from "./preview-bridge";
export { initPreviewBridge } from "@typren/core/ui/preview-bridge.vanilla";

export { CmsIntlProvider, useT } from "./intl";
