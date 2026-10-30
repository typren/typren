import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar } from "./avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("shows up to two initials when there is no image", () => {
    const { container } = render(<Avatar name="ada king lovelace" />);
    expect(container.textContent).toBe("AK");
  });

  it("falls back to nothing for an empty name and merges a class", () => {
    const { container } = render(<Avatar name="  " className="size-10" />);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild!.className).toContain("size-10");
  });
});
