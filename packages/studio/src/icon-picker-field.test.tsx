import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconPickerField } from "./icon-picker-field";

afterEach(cleanup);

const icons = {
  list: () => [
    { name: "star", render: () => <i /> },
    { name: "heart", render: () => <i /> },
  ],
};

describe("IconPickerField", () => {
  it("opens the picker dialog, filters, and commits the chosen icon", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<IconPickerField value="" onChange={onChange} icons={icons} />);
    await user.click(screen.getByRole("button", { name: "Choose icon" }));
    await user.type(await screen.findByPlaceholderText("Search icons…"), "he");
    expect(screen.queryByRole("button", { name: "star" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "heart" }));
    expect(onChange).toHaveBeenCalledWith("heart");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
