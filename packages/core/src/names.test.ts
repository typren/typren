import { describe, expect, it } from "vitest";
import { nameError, slugError } from "./names";

describe("slugError", () => {
  it("explains each rule a slug segment breaks, else null", () => {
    expect(slugError("", [])).toBe("Enter a slug.");
    expect(slugError("a".repeat(65), [])).toBe("Use 64 characters or fewer.");
    expect(slugError("About", [])).toBe("Use lowercase letters.");
    expect(slugError("-a", [])).toBe("Start with a letter or number.");
    expect(slugError("a_b", [])).toBe("Use letters, numbers and - only.");
    expect(slugError("about", ["about"])).toBe("That slug is already used here.");
    expect(slugError("a".repeat(64), ["about"])).toBeNull();
  });
});

describe("nameError", () => {
  it("explains each rule a media name breaks, keeping the extension out of it", () => {
    expect(nameError(".webp", [], ".webp")).toBe("Enter a name.");
    expect(nameError("a".repeat(65), [])).toBe("Use 64 characters or fewer.");
    expect(nameError("Photo", [])).toBe("Use lowercase letters.");
    expect(nameError("_a", [])).toBe("Start with a letter or number.");
    expect(nameError("a b", [])).toBe("Use letters, numbers, - and _ only.");
    expect(nameError("a", ["a.webp"], ".webp")).toBe("That name is already used here.");
    expect(nameError("a_b.webp", ["a.webp"], ".webp")).toBeNull();
  });
});
