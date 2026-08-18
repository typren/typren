"use client";

import { useEffect } from "react";
import { initPreviewBridge } from "@typren/core/ui/preview-bridge.vanilla";

/**
 * Rendered inside the preview route. Bridges the preview iframe and the editor:
 *  - click a block (an element wrapped with `data-typren-index`) to select it;
 *    click the page background to select the page itself
 *  - double-click a text element to edit it inline; on blur the new text is
 *    posted back to the editor, which maps it to the matching slice field
 *  - applies an independent light/dark theme + scroll-to on request
 *
 * The logic lives in `@typren/core`'s vanilla bridge (it must stay framework-free;
 * it runs inside the customer's own site, not this package) and this is a
 * thin React mount for it, same shape the `typren init` scaffolder writes into
 * a host app.
 */
export function PreviewBridge() {
  useEffect(() => initPreviewBridge(), []);
  return null;
}
