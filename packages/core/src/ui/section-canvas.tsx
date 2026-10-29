import type { ComponentType } from "react";
import type { CmsConfig } from "../types";
import { parseSectionMap, parseSectionQuery } from "../section-query";
import { CanvasUnavailable } from "./canvas";
import { MultiSectionCanvas } from "./section-canvas-multi";
import { StudioBridge } from "./studio-bridge";

type Query = { slice?: string | string[]; slices?: string | string[]; page?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The page behind `<site>/typren/section?slice=<json>`: renders one slice
 *  alone so the studio can show it as a real thumbnail. Mount it as a site's
 *  `app/typren/section/page.tsx` default export.
 *
 *  Pass the registry to render the slice on the server from `searchParams`;
 *  any component works, but a static export (`output: "export"`) refuses the
 *  query even under `next dev`. Pass a client canvas instead (see
 *  `createClientSectionCanvas`) and the slice renders in the browser, so the
 *  page never reads `searchParams` and exports as static.
 *
 *  Closed unless `typren studio` is previewing (same rule as the scaffold's
 *  `studioPreview`), and then it never reads `searchParams` either.
 *  ponytail: closed means an empty 200, not a 404 (`notFound()` would break
 *  `output: "export"`); the route exists in production but renders nothing.
 *  The bridge mounts even for an empty or unknown slice: the studio's probe
 *  sends `{slice:""}` and waits for the bridge's `rects` post.
 *
 *  With `?slices=` instead, the page is the studio's whole Templates grid
 *  (see `MultiSectionCanvas`): the server form renders every slice in that
 *  query, by key; the client form renders what the studio posts.
 *
 *  With `?page`, the client form is the studio's persistent page canvas
 *  (see `createCanvas`). The server form has no client renderer, so it
 *  answers that it cannot, and the studio frames the real route instead. */
export function createSectionCanvas(source: CmsConfig["registry"] | ComponentType<{ origin?: string }>) {
  // Next's generated PageProps check wants exactly a promise here; a union
  // with a plain object fails `next build`'s type check.
  return async function SectionCanvas({ searchParams }: Readonly<{ searchParams: Promise<Query> }>) {
    if (process.env.TYPREN_PREVIEW !== "1" || process.env.NODE_ENV === "production") return null;
    const origin = process.env.TYPREN_STUDIO_ORIGIN;
    // A client reference arrives as a function; a registry is a plain object.
    if (typeof source === "function") {
      const Canvas = source;
      return <Canvas origin={origin} />;
    }
    const registry = source;
    const known = (k: string) => Object.hasOwn(registry, k);
    const { slice, slices, page } = await searchParams;
    if (page !== undefined) return <CanvasUnavailable origin={origin} />;
    if (slices !== undefined) {
      const rendered = Object.fromEntries(
        Object.entries(parseSectionMap(first(slices), known)).map(([key, s]) => {
          const Section = registry[s.slice] as ComponentType<Record<string, unknown>>;
          return [key, <Section {...s} />];
        })
      );
      return <MultiSectionCanvas origin={origin} rendered={rendered} />;
    }
    const parsed = parseSectionQuery(first(slice), known);
    const Component = parsed && (registry[parsed.slice] as ComponentType<Record<string, unknown>>);
    return (
      <>
        {Component && (
          <div data-typren-index={0}>
            <Component {...parsed} />
          </div>
        )}
        <StudioBridge origin={origin} />
      </>
    );
  };
}
