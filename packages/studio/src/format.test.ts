import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("formats an ISO timestamp as day, short month, year", () => {
    expect(formatDate("2026-10-27T12:00:00Z")).toBe("27 Oct 2026");
  });

  it("returns a dash when the date does not parse", () => {
    expect(formatDate("not a date")).toBe("—");
  });
});
