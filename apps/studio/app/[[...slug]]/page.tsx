import { loadStudioProps } from "@typren/core";
import { HOME } from "@/lib/navigation";
import { StudioMount } from "@/components/studio-mount";
import { readManifest, studioConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  params,
}: Readonly<{ params: Promise<{ slug?: string[] }> }>) {
  const manifest = readManifest();
  // "/<section>" opens a rail entry and "/pages/<slug>" a page. Anywhere but a
  // page URL previews home, as the site's own "/" does.
  const [sectionId, ...rest] = (await params).slug ?? [];
  const slug = sectionId === "pages" && rest.length ? rest.join("/") : (manifest.homeSlug ?? HOME);
  const props = await loadStudioProps(studioConfig(manifest), manifest, slug);
  if (!props) return <p className="p-6">Unauthorized. The studio only serves loopback requests in development.</p>;
  return <StudioMount {...props} apiBase="/api/typren" />;
}
