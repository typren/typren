import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyState, EmptyTitle } from "./empty";

afterEach(cleanup);

describe("Empty", () => {
  it("renders every slot", () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><svg data-testid="i" /></EmptyMedia>
          <EmptyTitle>Nothing here</EmptyTitle>
          <EmptyDescription>Add something.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><button>Add</button></EmptyContent>
      </Empty>
    );
    expect(screen.getByText("Nothing here").getAttribute("data-slot")).toBe("empty-title");
    expect(screen.getByText("Add something.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("only the icon variant gets the tile", () => {
    render(
      <>
        <EmptyMedia variant="icon" data-testid="a" />
        <EmptyMedia data-testid="b" />
      </>
    );
    expect(screen.getByTestId("a").className).toContain("bg-[var(--typren-fill-control)]");
    expect(screen.getByTestId("b").className).not.toContain("bg-[var(--typren-fill-control)]");
  });
});

describe("EmptyState", () => {
  it("lays out icon, title, description and actions", () => {
    render(
      <EmptyState icon={<svg data-testid="icon" />} title="No pages" description="Make one." className="extra">
        <button>New</button>
      </EmptyState>
    );
    expect(screen.getByTestId("icon").parentElement?.getAttribute("data-variant")).toBe("icon");
    expect(screen.getByText("No pages").getAttribute("data-slot")).toBe("empty-title");
    expect(screen.getByText("Make one.").getAttribute("data-slot")).toBe("empty-description");
    expect(screen.getByRole("button", { name: "New" }).parentElement?.getAttribute("data-slot")).toBe("empty-content");
    expect(screen.getByText("No pages").closest("[data-slot=empty]")?.className).toContain("extra");
  });

  it("leaves out the slots it isn't given", () => {
    const { container } = render(<EmptyState icon={<svg />} title="Nothing" />);
    expect(container.querySelector("[data-slot=empty-description], [data-slot=empty-content]")).toBeNull();
  });
});
