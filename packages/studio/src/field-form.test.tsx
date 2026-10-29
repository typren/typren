import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Slice, SliceSchema } from "@typren/core";
import { FieldForm } from "./field-form";

afterEach(cleanup);

const schema: SliceSchema = { align: { type: "select", options: ["left", "right"], label: "Align" } };

function mount(slice: Slice) {
  const onChange = vi.fn();
  render(<FieldForm slice={slice} schema={schema} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe("FieldForm enum select", () => {
  it("sets the chosen option", async () => {
    const { onChange, user } = mount({ slice: "hero", align: "left" });
    await user.click(screen.getByRole("combobox", { name: "Align" }));
    await user.click(await screen.findByRole("option", { name: "right" }));
    expect(onChange).toHaveBeenCalledWith({ slice: "hero", align: "right" });
  });

  it("removes the field when (none) is chosen", async () => {
    const { onChange, user } = mount({ slice: "hero", align: "left" });
    await user.click(screen.getByRole("combobox", { name: "Align" }));
    await user.click(await screen.findByRole("option", { name: "(none)" }));
    expect(onChange).toHaveBeenCalledWith({ slice: "hero" });
  });

  it("keeps a value outside the options as a custom entry", async () => {
    const { user } = mount({ slice: "hero", align: "center" });
    expect(screen.getByRole("combobox", { name: "Align" }).textContent).toContain("center (custom)");
    await user.click(screen.getByRole("combobox", { name: "Align" }));
    expect(await screen.findByRole("option", { name: "center (custom)" })).toBeTruthy();
  });
});

describe("FieldForm labels", () => {
  it("ties every control to its label", () => {
    render(
      <FieldForm
        slice={{ slice: "hero", title: "Hi", count: 2, body: "x".repeat(80), link: { label: "a", href: "b" }, items: [{}] }}
        schema={{ items: { type: "slot", of: {} }, link: { type: "link" } }}
        onChange={vi.fn()}
      />
    );
    expect((screen.getByLabelText("title") as HTMLInputElement).value).toBe("Hi");
    expect(screen.getByLabelText("count")).toBeTruthy();
    expect(screen.getByLabelText("body")).toBeTruthy();
    expect(screen.getByRole("group", { name: "link" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "items" })).toBeTruthy();
  });
});

describe("FieldForm image field", () => {
  it("names Replace and Remove after the field", () => {
    render(
      <FieldForm
        slice={{ slice: "hero", logo: "/a.webp" }}
        schema={{ logo: { type: "image", label: "Logo" } }}
        onChange={vi.fn()}
        media={{ list: async () => [], upload: async () => "" } as never}
      />
    );
    expect(screen.getByRole("button", { name: "Replace Logo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Logo" })).toBeTruthy();
  });
});
