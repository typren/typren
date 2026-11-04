import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_FAILURE, errorMessage, fail, printJson } from "./output";

describe("output", () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let saved: typeof process.exitCode;
  beforeEach(() => {
    saved = process.exitCode;
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = saved;
  });

  it("fail without json writes stderr only", () => {
    fail("scan", "boom", false);
    expect(error).toHaveBeenCalledWith("typren-locale scan: boom");
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT_FAILURE);
  });

  it("fail with json also prints {ok:false,error}", () => {
    fail("lint", "bad", true);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual({ ok: false, error: "bad" });
    expect(process.exitCode).toBe(EXIT_FAILURE);
  });

  it("printJson pretty-prints", () => {
    printJson({ a: 1 });
    expect(log).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it("errorMessage handles Error and non-Error", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("y")).toBe("y");
  });
});
