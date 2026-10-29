import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TopBarButton } from "./top-bar-button";

describe("TopBarButton", () => {
  afterEach(cleanup);

  it("is the square standard button when icon-only", () => {
    render(<TopBarButton aria-label="Menu"><svg /></TopBarButton>);
    const b = screen.getByRole("button", { name: "Menu" });
    expect(b.className).toContain("size-[var(--typren-control-h)]");
    expect(b.className).toContain("bg-[var(--typren-fill-control)]");
  });

  it("shows its label from md up and its icon in the same square below", () => {
    render(<TopBarButton label="Edit"><svg data-testid="icon" /></TopBarButton>);
    const b = screen.getByRole("button", { name: "Edit" });
    expect(b.className).toContain("max-md:size-[var(--typren-control-h)]");
    expect(screen.getByTestId("icon").parentElement?.className).toContain("md:hidden");
    expect(screen.getByText("Edit").className).toContain("max-md:sr-only");
  });
});
