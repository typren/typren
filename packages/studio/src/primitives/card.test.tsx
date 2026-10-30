import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

afterEach(cleanup);

describe("Card", () => {
  it("renders every slot and merges a caller class", () => {
    render(
      <Card className="w-80">
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>Billed monthly</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>,
    );
    expect(screen.getByText("Plan").dataset.slot).toBe("card-title");
    expect(screen.getByText("Billed monthly").dataset.slot).toBe("card-description");
    expect(screen.getByText("Body").dataset.slot).toBe("card-content");
    expect(screen.getByText("Foot").dataset.slot).toBe("card-footer");
    expect(screen.getByText("Plan").closest("[data-slot=card]")!.className).toContain("w-80");
  });
});
