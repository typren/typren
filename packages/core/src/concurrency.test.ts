import { describe, it, expect } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
  it("never runs more than `limit` calls concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapLimit(items, 3, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return i;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("returns results in input order regardless of completion order", async () => {
    const items = [30, 10, 20, 5];
    const result = await mapLimit(items, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual(items);
  });

  it("handles an empty input and a limit larger than the input", async () => {
    expect(await mapLimit([], 5, async (x) => x)).toEqual([]);
    expect(await mapLimit([1, 2], 5, async (x) => x * 2)).toEqual([2, 4]);
  });
});
