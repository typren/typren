import { describe, expect, it, vi } from "vitest";
import type { TyprenClient } from "@typren/core/api/client";
import { clientHost, STUDIO_SECTIONS } from "./client-host";

const site = { sliceNames: ["hero"], defaults: { hero: {} }, previewPath: "http://127.0.0.1:4401", homeSlug: "home", trailingSlash: true, git: false };
const client = { library: {}, gitPush: vi.fn() } as unknown as TyprenClient;

describe("clientHost", () => {
  it("frames home at the site root and other pages with the site's trailing slash", () => {
    const host = clientHost(client, site, "/api/typren/media");
    expect(host.previewUrl!("home")).toBe("http://127.0.0.1:4401/");
    expect(host.previewUrl!("about")).toBe("http://127.0.0.1:4401/about/");
    expect(host.sectionPreviewUrl).toBeUndefined();
    expect(host.media!.uploadPath).toBe("/api/typren/media");
  });

  it("defaults the rail and wires git only for a git checkout", () => {
    expect(clientHost(client, site, "").sections).toBe(STUDIO_SECTIONS);
    expect(clientHost(client, site, "").git).toBeUndefined();
    const host = clientHost(client, { ...site, git: true, sectionRouteUrl: "http://127.0.0.1:4401/typren/section" }, "");
    expect(host.sectionPreviewUrl).toBe("http://127.0.0.1:4401/typren/section/");
    void host.git!.push(["a"]);
    expect(client.gitPush).toHaveBeenCalledWith(["a"], undefined, undefined);
  });
});
