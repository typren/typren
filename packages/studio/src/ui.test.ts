import { describe, expect, it } from "vitest";
import * as ui from "./ui";

describe("@typren/studio/ui", () => {
  it("exports each primitive as a component or function", () => {
    for (const [name, value] of Object.entries(ui)) {
      expect(["function", "object"], name).toContain(typeof value);
    }
    expect(Object.keys(ui)).toEqual(expect.arrayContaining(["Button", "Card", "Avatar", "Menu", "cn"]));
  });
});
