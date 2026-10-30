import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PanelHeader } from "./panel-header";

describe("PanelHeader", () => {
  afterEach(cleanup);

  it("titles the level and seats its actions", () => {
    render(
      <PanelHeader title="Pages">
        <button type="button">Add</button>
      </PanelHeader>
    );
    expect(screen.getByTitle("Pages").textContent).toBe("Pages");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});
