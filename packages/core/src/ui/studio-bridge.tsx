"use client";

import { useEffect } from "react";
import { initPreviewBridge } from "./preview-bridge.vanilla";

/** Talks to the `typren studio` editor framing this page. `origin` is the
 *  studio's own origin (`TYPREN_STUDIO_ORIGIN`, which `typren studio` sets):
 *  the only one the bridge posts to or accepts. Without it the bridge stays
 *  off rather than guess. `nonce` is the page canvas's session nonce (see
 *  `initPreviewBridge`). */
export function StudioBridge({ origin, nonce }: Readonly<{ origin?: string; nonce?: string }>) {
  useEffect(() => (origin ? initPreviewBridge(origin, nonce) : undefined), [origin, nonce]);
  return null;
}
