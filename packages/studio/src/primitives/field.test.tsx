import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckboxRow, Field } from "./field";

describe("Field", () => {
  afterEach(cleanup);

  it("labels its control and notes under it by id", () => {
    render(
      <Field label="Slug" htmlFor="slug" note="Kept for the home page.">
        <input id="slug" aria-describedby="slug-note" />
      </Field>
    );
    const input = screen.getByLabelText("Slug");
    expect(screen.getByText("Kept for the home page.").id).toBe("slug-note");
    expect(input.getAttribute("aria-describedby")).toBe("slug-note");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces an error note", () => {
    render(
      <Field label="Link" htmlFor="href" note="Enter a link." error>
        <input id="href" />
      </Field>
    );
    expect(screen.getByRole("alert").textContent).toBe("Enter a link.");
  });

  it("leaves the note out when there is none", () => {
    const { container } = render(
      <Field label="Name" htmlFor="name" note={null} error>
        <input id="name" />
      </Field>
    );
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("CheckboxRow", () => {
  afterEach(cleanup);

  it("toggles and reports the new state", async () => {
    const onChange = vi.fn();
    render(<CheckboxRow label="External link" checked={false} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "External link" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("describes the box with its note", () => {
    render(<CheckboxRow label="Show in navigation" note="Adds a menu item." checked disabled onChange={() => {}} />);
    const box = screen.getByRole("checkbox", { name: /Show in navigation/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(document.getElementById(box.getAttribute("aria-describedby")!)?.textContent).toBe("Adds a menu item.");
  });
});

describe("CheckboxRow indeterminate", () => {
  afterEach(cleanup);

  it("shows the mixed state, and clears it", () => {
    const { rerender } = render(<CheckboxRow label="Select all" checked={false} indeterminate onChange={() => {}} />);
    const box = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    rerender(<CheckboxRow label="Select all" checked onChange={() => {}} />);
    expect(box.indeterminate).toBe(false);
  });
});
