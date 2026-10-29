import { describe, expect, it } from "vitest";
import { studioHeaders } from "./headers";

const forPath = (path: string) =>
  studioHeaders
    .filter((r) => (r.source === "/:path*" ? true : path.startsWith(r.source.replace(":path*", ""))))
    .flatMap((r) => r.headers);

describe("studioHeaders", () => {
  it("refuses framing and sniffing on every route", () => {
    const h = forPath("/pages/home");
    expect(h).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(h).toContainEqual({ key: "Content-Security-Policy", value: "frame-ancestors 'none'" });
    expect(h).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
  });

  it("sandboxes proxied site images and keeps them unframeable", () => {
    // Next keeps the last matching value for a repeated key, so the /img rule
    // must restate frame-ancestors rather than rely on the catch-all.
    const csp = forPath("/img/x.svg").filter((x) => x.key === "Content-Security-Policy").at(-1)!.value;
    expect(csp).toMatch(/^sandbox;/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
