import type { PageActions, SliceSchema } from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import type { FieldFormIcons } from "./icon-picker-field";

/**
 * Everything host-specific the editor needs, in one injected object — the
 * seam that lets `apps/studio` and a future hosted console mount the exact
 * same `@typren/editor` without drifting. Nothing in this package reaches
 * outside of `host` for a host-owned concern (auth, storage, the slice
 * registry).
 *
 * v1 scope is the Pages editing loop only; `media`/`icons` already degrade
 * gracefully when omitted (see FieldForm), so a host with no media library or
 * icon set configured needs nothing extra here.
 */
export interface TyprenEditorHost {
  /** Auth-gated page CRUD/draft/publish handlers — bind these to Server
   *  Actions (or an equivalent RPC) on the host; see `makeActions()`. */
  actions: PageActions;
  /** Slice registry keys, for BlockList's "+ Add block" menu. The host
   *  renders the actual components in its own preview route. */
  sliceNames: string[];
  /** Starter props inserted when a slice is added, keyed by slice name. */
  defaults: Record<string, Record<string, unknown>>;
  /** Optional per-slice field hints (dropdowns for enum props, etc.). */
  fieldSchema?: Record<string, SliceSchema>;
  /** Route the editor iframes for live preview, e.g. "/editor/preview". */
  previewPath: string;
  /** Wires FieldForm's "image"/"media" control to a media library. Omit to
   *  degrade those fields to a plain text input (no media section wired). */
  media?: FieldFormMedia;
  /** Wires FieldForm's "icon" control to an icon picker. Omit to degrade to
   *  a plain text input (no icon library wired). */
  icons?: FieldFormIcons;
}
