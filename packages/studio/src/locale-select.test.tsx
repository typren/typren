import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleSelect } from "./locale-select";

describe("LocaleSelect", () => {
  afterEach(cleanup);

  it("shows the locale code and reports another pick only", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocaleSelect value="en" locales={["en", "fr"]} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Preview locale" });
    expect(trigger.textContent).toContain("en");
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "en" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "fr" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("fr");
  });
});
