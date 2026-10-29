"use client";

import type { ComponentType } from "react";
import type { CmsConfig } from "../types";
import { createCanvas } from "./canvas";
import { createReactRenderer } from "./canvas-react";

/** The section canvas for a static-export site: renders the slice in the
 *  browser from `window.location.search`, since `output: "export"` refuses
 *  `searchParams` even under `next dev`. Call it in a `"use client"` file and
 *  hand the result to `createSectionCanvas`, which keeps the gate on the
 *  server. ponytail: every registry component must render on the client, so
 *  an async server component or one importing server-only code cannot sit in
 *  this registry; such a site keeps `createSectionCanvas(registry)` and turns
 *  export off for the preview.
 *
 *  It holds its own gate too, for a site that mounts it without the server
 *  wrapper: it reads the query only outside a production build and only with
 *  an `origin`, which the wrapper passes just while the studio previews
 *  (`TYPREN_PREVIEW` never reaches the browser). Without one the bridge is
 *  inert anyway, so the studio could not use the canvas.
 *
 *  It is `createCanvas` with the React renderer, so it also serves the
 *  studio's page canvas (`?page`) and its Templates grid (`?slices=`). */
export function createClientSectionCanvas(registry: CmsConfig["registry"]) {
  const Canvas = createCanvas({ renderer: createReactRenderer(), registry: registry as Record<string, ComponentType<Record<string, unknown>>> });
  return function ClientSectionCanvas({ origin }: Readonly<{ origin?: string }>) {
    return <Canvas origin={origin} />;
  };
}
