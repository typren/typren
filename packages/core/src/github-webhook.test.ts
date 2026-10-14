import { describe, expect, it, vi } from "vitest";
import { createGithubWebhookHandler } from "./github-webhook";

const SECRET = "whs_test_secret";

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function pushRequest(body: unknown, opts: { secret?: string; event?: string; badSig?: boolean; noSig?: boolean } = {}) {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "x-github-event": opts.event ?? "push" };
  if (!opts.noSig) headers["x-hub-signature-256"] = opts.badSig ? "sha256=deadbeef" : await sign(opts.secret ?? SECRET, text);
  return new Request("https://example.com/api/github-webhook", { method: "POST", body: text, headers });
}

function push(ref: string, commits: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>) {
  return { ref, commits };
}

describe("createGithubWebhookHandler: construction", () => {
  it("throws at construction when secret is empty", () => {
    expect(() => createGithubWebhookHandler({ secret: "", onChange: async () => {} })).toThrow(/secret/);
  });
});

describe("createGithubWebhookHandler: signature verification", () => {
  it("401s a missing signature", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(push("refs/heads/main", []), { noSig: true });
    expect((await handler(req)).status).toBe(401);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("401s a bad signature", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(push("refs/heads/main", []), { badSig: true });
    expect((await handler(req)).status).toBe(401);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts a valid signature", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(push("refs/heads/main", [{ modified: ["content/about.md"] }]));
    expect((await handler(req)).status).toBe(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("createGithubWebhookHandler: event/ref routing", () => {
  it("200s a ping without calling onChange", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest({}, { event: "ping" });
    expect((await handler(req)).status).toBe(200);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("202s a non-push event", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest({}, { event: "issues" });
    expect((await handler(req)).status).toBe(202);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("202s a push to a branch other than the configured one", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, branch: "main", onChange });
    const req = await pushRequest(push("refs/heads/feature-x", [{ modified: ["content/about.md"] }]));
    expect((await handler(req)).status).toBe(202);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("400s a validly-signed body that isn't valid JSON", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const text = "{not json";
    const req = new Request("https://example.com/hook", {
      method: "POST",
      body: text,
      headers: { "x-github-event": "push", "x-hub-signature-256": await sign(SECRET, text) },
    });
    expect((await handler(req)).status).toBe(400);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("createGithubWebhookHandler: content filtering", () => {
  it("202s a draft-only push, never calling onChange", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(push("refs/heads/main", [{ modified: ["content/_drafts/about.md"] }]));
    expect((await handler(req)).status).toBe(202);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("excludes a locale-nested draft path too", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(
      push("refs/heads/main", [{ modified: ["content/fr/_drafts/about.md", "content/fr/about.md"] }])
    );
    await handler(req);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ["content/fr/about.md"], slugs: ["about"], locales: ["fr"] })
    );
  });

  it("ignores a path nested deeper than locale/slug.md (e.g. a collection dir), but still invalidates", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(
      push("refs/heads/main", [{ modified: ["content/products/widget/variants/a.md", "content/about.md"] }])
    );
    await handler(req);
    // The deep path isn't a Pages slug, so it contributes no slug/locale, but
    // it's still a real content change: full stays false and the shallow
    // path is still reported.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ slugs: ["about"], locales: [], full: false })
    );
  });

  it("202s a push that touches no path under contentDir", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(push("refs/heads/main", [{ modified: ["README.md"] }]));
    expect((await handler(req)).status).toBe(202);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with paths/slugs/locales for a published change, default locale has no locale entry", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest(
      push("refs/heads/main", [{ added: ["content/about.md"], modified: ["content/fr/about.md"] }])
    );
    expect((await handler(req)).status).toBe(200);
    expect(onChange).toHaveBeenCalledWith({
      paths: ["content/about.md", "content/fr/about.md"],
      slugs: ["about"],
      locales: ["fr"],
      full: false,
    });
  });

  it("asks for a full invalidation on a force push", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest({ ref: "refs/heads/main", forced: true, commits: [{ modified: ["README.md"] }] });
    expect((await handler(req)).status).toBe(200);
    expect(onChange).toHaveBeenCalledWith({ paths: [], slugs: [], locales: [], full: true });
  });

  it("asks for a full invalidation when the payload carries no commit list", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    expect((await handler(await pushRequest({ ref: "refs/heads/main" }))).status).toBe(200);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ full: true }));
  });

  it("ignores a branch deletion", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const req = await pushRequest({ ref: "refs/heads/main", deleted: true, commits: [] });
    expect((await handler(req)).status).toBe(202);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("maps onChange throwing to a 500 (so GitHub retries/redelivers)", async () => {
    const handler = createGithubWebhookHandler({
      secret: SECRET,
      onChange: async () => {
        throw new Error("revalidate failed");
      },
    });
    const req = await pushRequest(push("refs/heads/main", [{ modified: ["content/about.md"] }]));
    expect((await handler(req)).status).toBe(500);
  });
});

describe("createGithubWebhookHandler: body size cap", () => {
  it("413s a body over 5MB via content-length", async () => {
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange: async () => {} });
    const req = new Request("https://example.com/hook", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(6 * 1024 * 1024), "x-github-event": "push" },
    });
    expect((await handler(req)).status).toBe(413);
  });

  it("413s a chunked body with no content-length, without reading the whole stream", async () => {
    // No content-length header at all (the chunked-transfer case): the only
    // guard that can catch this is the streaming byte count, not a header.
    const chunkSize = 1024 * 1024; // 1MB
    const totalChunks = 10; // 10MB of chunks available; the cap is 5MB
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= totalChunks) {
          controller.close();
          return;
        }
        pulled++;
        controller.enqueue(new Uint8Array(chunkSize));
      },
    });
    const req = new Request("https://example.com/hook", {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { "x-github-event": "push" },
    } as RequestInit);

    const handler = createGithubWebhookHandler({ secret: SECRET, onChange: async () => {} });
    expect((await handler(req)).status).toBe(413);
    // Must have bailed out partway through, not pulled every available chunk.
    expect(pulled).toBeLessThan(totalChunks);
  });

  it("a non-numeric content-length doesn't crash or bypass the size check", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const body = push("refs/heads/main", [{ modified: ["content/about.md"] }]);
    const text = JSON.stringify(body);
    const req = new Request("https://example.com/hook", {
      method: "POST",
      body: text,
      headers: {
        "content-length": "not-a-number",
        "x-github-event": "push",
        "x-hub-signature-256": await sign(SECRET, text),
      },
    });
    expect((await handler(req)).status).toBe(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("createGithubWebhookHandler: delivery dedupe", () => {
  it("202s a redelivered X-GitHub-Delivery id instead of invalidating twice", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const body = push("refs/heads/main", [{ modified: ["content/about.md"] }]);
    const text = JSON.stringify(body);
    const sig = await sign(SECRET, text);
    const req1 = new Request("https://example.com/hook", {
      method: "POST",
      body: text,
      headers: { "x-github-event": "push", "x-github-delivery": "dup-id", "x-hub-signature-256": sig },
    });
    const req2 = new Request("https://example.com/hook", {
      method: "POST",
      body: text,
      headers: { "x-github-event": "push", "x-github-delivery": "dup-id", "x-hub-signature-256": sig },
    });

    expect((await handler(req1)).status).toBe(200);
    expect(onChange).toHaveBeenCalledTimes(1);

    const res2 = await handler(req2);
    expect(res2.status).toBe(202);
    expect(onChange).toHaveBeenCalledTimes(1); // not called again
  });

  it("different delivery ids are each processed", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const body = push("refs/heads/main", [{ modified: ["content/about.md"] }]);
    const text = JSON.stringify(body);
    const sig = await sign(SECRET, text);
    for (const id of ["id-a", "id-b"]) {
      const req = new Request("https://example.com/hook", {
        method: "POST",
        body: text,
        headers: { "x-github-event": "push", "x-github-delivery": id, "x-hub-signature-256": sig },
      });
      expect((await handler(req)).status).toBe(200);
    }
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest delivery id once past the LRU cap, so it can be seen again", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const body = push("refs/heads/main", [{ modified: ["content/about.md"] }]);
    const text = JSON.stringify(body);
    const sig = await sign(SECRET, text);
    const send = (id: string) =>
      handler(
        new Request("https://example.com/hook", {
          method: "POST",
          body: text,
          headers: { "x-github-event": "push", "x-github-delivery": id, "x-hub-signature-256": sig },
        })
      );

    expect((await send("id-0")).status).toBe(200);
    // Push 1000 MORE distinct ids: "id-0" is now the oldest of 1001 seen,
    // past the 1000-entry cap, so it must have been evicted.
    for (let i = 1; i <= 1000; i++) await send(`id-${i}`);
    expect((await send("id-0")).status).toBe(200); // processed again, not 202
    expect(onChange).toHaveBeenCalledTimes(1002);
  });
});

describe("createGithubWebhookHandler: truncated commit list", () => {
  it("treats a commit list at GitHub's own cap as truncated (full: true)", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const commits = Array.from({ length: 2048 }, () => ({ modified: ["content/about.md"] }));
    const req = await pushRequest(push("refs/heads/main", commits));
    expect((await handler(req)).status).toBe(200);
    expect(onChange).toHaveBeenCalledWith({ paths: [], slugs: [], locales: [], full: true });
  });

  it("still enumerates a commit list safely under the cap", async () => {
    const onChange = vi.fn();
    const handler = createGithubWebhookHandler({ secret: SECRET, onChange });
    const commits = Array.from({ length: 2047 }, () => ({ modified: ["content/about.md"] }));
    const req = await pushRequest(push("refs/heads/main", commits));
    expect((await handler(req)).status).toBe(200);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ full: false }));
  });
});
