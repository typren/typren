import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

afterEach(cleanup);

const thumb = () => screen.getByRole("group").querySelector<HTMLElement>("span[aria-hidden]");

describe("ToggleGroup", () => {
  it("puts the sliding thumb under the pressed item and follows a change", async () => {
    render(
      <ToggleGroup aria-label="View" defaultValue={["a"]}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>
    );
    const [a, b] = screen.getAllByRole("button");
    Object.defineProperty(b, "offsetLeft", { value: 40 });
    Object.defineProperty(b, "offsetWidth", { value: 36 });
    expect(a.hasAttribute("data-pressed")).toBe(true);
    expect(thumb()).toBeTruthy();
    await userEvent.setup().click(b);
    await waitFor(() => expect(thumb()!.style.transform).toBe("translateX(40px)"));
    expect(thumb()!.style.width).toBe("36px");
  });

  it("has no thumb while nothing is pressed", () => {
    render(
      <ToggleGroup aria-label="View">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>
    );
    expect(thumb()).toBeNull();
  });
});
