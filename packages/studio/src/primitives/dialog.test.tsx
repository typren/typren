import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders a header with title and description", async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>Pick a new name.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(await screen.findByText("Pick a new name.")).toBeTruthy();
    expect(document.querySelector("[data-slot=dialog-header]")).not.toBeNull();
  });
});
