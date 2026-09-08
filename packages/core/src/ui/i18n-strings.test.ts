import { describe, it, expect } from "vitest";
import { createT } from "./i18n-strings";

describe("createT", () => {
  it("prefers a host override over the English default", () => {
    const t = createT({ "nav.pages": "Seiten" });
    expect(t("nav.pages")).toBe("Seiten");
  });

  it("falls back to the English default when no override exists", () => {
    const t = createT();
    expect(t("nav.pages")).toBe("Pages");
  });

  it("falls back to the literal key for unknown keys", () => {
    const t = createT();
    expect(t("nav.doesNotExist")).toBe("nav.doesNotExist");
  });

  it("interpolates {var} placeholders, repeatedly", () => {
    const t = createT({ greet: "Hi {name}, bye {name}, count {n}" });
    expect(t("greet", { name: "Ada", n: 2 })).toBe("Hi Ada, bye Ada, count 2");
  });
});
