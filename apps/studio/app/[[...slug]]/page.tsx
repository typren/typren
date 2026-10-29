import { HOME } from "@/lib/navigation";
import { StudioMount } from "@/components/studio-mount";
import { loadStudio, previewBase, readManifest, sectionRouteUrl, siteTrailingSlash, studioConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  params,
}: Readonly<{ params: Promise<{ slug?: string[] }> }>) {
  const manifest = readManifest();
  // "/<section>" opens a rail entry and "/pages/<slug>" a page. Anywhere but a
  // page URL previews home, as the site's own "/" does.
  const [sectionId, ...rest] = (await params).slug ?? [];
  const homeSlug = manifest.homeSlug ?? HOME;
  const slug = sectionId === "pages" && rest.length ? rest.join("/") : homeSlug;
  const config = studioConfig(manifest);
  const data = await loadStudio(config, slug);
  if (!data) return <p className="p-6">Unauthorized. The studio only serves loopback requests in development.</p>;
  return (
    <StudioMount
      {...data}
      apiBase="/api/typren"
      sliceNames={Object.keys(manifest.defaults)}
      defaults={manifest.defaults}
      fieldSchema={manifest.fieldSchema}
      previewPath={previewBase(manifest)}
      sectionRouteUrl={sectionRouteUrl(manifest)}
      nestedLayouts={manifest.nestedLayouts}
      homeSlug={homeSlug}
      sections={manifest.sections}
      writeBootstrap={manifest.writeBootstrap}
      trailingSlash={await siteTrailingSlash(previewBase(manifest), data.pages.find((p) => p.slug !== homeSlug)?.slug)}
      git={Boolean(config.git)}
      styleMap={manifest.styleMap}
    />
  );
}
