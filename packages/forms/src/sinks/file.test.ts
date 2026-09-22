import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Submission } from "../types";
import { createFileSink } from "./file";

const schema = { id: "contact", fields: [] };

function makeSubmission(name: string): Submission {
  return { formId: "contact", fields: { name }, meta: { submittedAt: "2026-09-22T00:00:00.000Z" } };
}

describe("createFileSink", () => {
  it("appends one JSONL line per submission, creating parent directories", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "typren-forms-")), "nested", "submissions.jsonl");
    const sink = createFileSink({ type: "file", path: file });

    expect(await sink.deliver(makeSubmission("Ada"), schema)).toEqual({ ok: true });
    expect(await sink.deliver(makeSubmission("Grace"), schema)).toEqual({ ok: true });

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => (JSON.parse(line) as Submission).fields.name)).toEqual(["Ada", "Grace"]);
  });
});
