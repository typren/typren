import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withToken } from "./style-parts";
import { ColorsScreen, alphaOf, contrast, grade, mix, toHex, toRgb } from "./style-colors";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ initial, site }: Readonly<{ initial: Record<string, string>; site?: Record<string, string> }>) {
  const [style, setStyle] = useState(initial);
  return (
    <ColorsScreen
      style={style}
      site={site}
      set={(n, v) => setStyle((s) => withToken(s, n, v))}
    />
  );
}

describe("colour maths", () => {
  it("reads hex and rgb()", () => {
    expect(toRgb("#fff")).toEqual([255, 255, 255]);
    expect(toRgb("#11223344")).toEqual([17, 34, 51]);
    expect(toRgb("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(toRgb("rgb(100% 0% 50%)")).toEqual([255, 0, 128]);
    expect(toRgb("")).toBeNull();
    expect(toHex([17, 34, 51])).toBe("#112233");
  });

  it("falls back to a canvas for other syntaxes, and to null without one", () => {
    expect(toRgb("oklch(0.6 0.2 30)")).toBeNull();
    let fill = "#000000";
    const ctx = {
      get fillStyle() {
        return fill;
      },
      set fillStyle(v: string) {
        if (v !== "bogus") fill = v === "#000" ? "#000000" : v === "#fff" ? "#ffffff" : "#ff0000";
      },
      clearRect: () => {},
      fillRect: () => {},
      getImageData: () => ({ data: [255, 0, 0, 255] }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    expect(toRgb("oklch(0.6 0.2 30)")).toEqual([255, 0, 0]);
    expect(toRgb("bogus")).toBeNull();
  });

  it("reads the alpha a value carries", () => {
    expect(alphaOf("#ff000080")).toBeCloseTo(0.5, 2);
    expect(alphaOf("#f008")).toBeCloseTo(0.533, 2);
    expect(alphaOf("rgba(1, 2, 3, 0.25)")).toBe(0.25);
    expect(alphaOf("oklch(0.5 0.2 260 / 40%)")).toBe(0.4);
    expect(alphaOf("rgb(1, 2, 3)")).toBe(1);
    expect(alphaOf("#fff")).toBe(1);
    expect(alphaOf(undefined)).toBe(1);
  });

  it("computes WCAG contrast and grades it", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBe(1);
    expect(grade(8)).toBe("AAA");
    expect(grade(5)).toBe("AA");
    expect(grade(3.2)).toBe("AA Large");
    expect(grade(2)).toBe("Fails");
    expect(grade(3.2, true)).toBe("Pass");
    expect(grade(2, true)).toBe("Fails");
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
  });
});

describe("ColorsScreen", () => {
  const style = { "--typren-primary": "#000000", "--typren-primary-fg": "#ffffff", "--typren-bg": "#ffffff", "--typren-border": "#eeeeee" };

  it("shows each pair's contrast on its swatch, and Not set where a side is missing", () => {
    render(<Harness initial={style} />);
    expect(within(screen.getByRole("option", { name: "Primary" })).getByText("21.0:1 AAA")).toBeTruthy();
    expect(within(screen.getByRole("option", { name: "Border" })).getByText(/:1 Fails/)).toBeTruthy();
    expect(within(screen.getByRole("option", { name: "Background" })).getByTitle("Text is not set").textContent).toBe("—");
    expect(within(screen.getByRole("option", { name: "Muted" })).getAllByText("Not set")).toHaveLength(2);
  });

  it("opens the side panel for the selection, with contrast, shades and reset", async () => {
    const user = userEvent.setup();
    render(<Harness initial={style} />);
    await user.click(screen.getByRole("option", { name: "Primary" }));
    const panel = screen.getByRole("complementary", { name: "Primary settings" });
    expect(within(panel).getByText("Contrast against Text on primary")).toBeTruthy();
    expect(within(panel).getByText("21.00:1")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Use #666666" }));
    expect(within(screen.getByRole("option", { name: "Primary" })).getByText("#666666")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Reset to default" }));
    expect(within(screen.getByRole("option", { name: "Primary" })).getAllByText("Not set").length).toBeGreaterThan(0);
    expect(within(panel).queryByText("Shades and tints")).toBeNull();
  });

  it("explains a pair it can't check yet", async () => {
    const user = userEvent.setup();
    render(<Harness initial={style} />);
    await user.click(screen.getByRole("option", { name: "Background" }));
    expect(screen.getByText("Set Text too to check this pair.")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Border" }));
    expect(screen.getByText("Borders and controls need 3:1.")).toBeTruthy();
  });

  it("moves with the arrows, focuses the panel on Enter, and closes on Escape or Close", async () => {
    const user = userEvent.setup();
    render(<Harness initial={style} />);
    await user.click(screen.getByRole("option", { name: "Primary" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("complementary", { name: "Text on primary settings" })).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Text on primary picker"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Text on primary" }));
    await user.dblClick(screen.getByRole("option", { name: "Accent" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("selects from the palette strip and clears on a click outside", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial={style} />);
    await user.click(container.querySelector("[aria-hidden] > div")!);
    expect(screen.getByRole("complementary", { name: "Primary settings" })).toBeTruthy();
    await user.click(screen.getByLabelText("Palette"));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("draws the site's resolved colours as swatches and offers them as presets", async () => {
    const user = userEvent.setup();
    // What the preview bridge sends for light-dark() and color-mix() values: rgb.
    const site = { "--typren-primary": "rgb(0, 17, 51)", "--typren-primary-fg": "rgb(255, 255, 255)", "--typren-bg": "rgba(128, 128, 128, 0.502)" };
    render(<Harness initial={{}} site={site} />);
    const primary = screen.getByRole("option", { name: "Primary" });
    expect(within(primary).getByText("18.6:1 AAA")).toBeTruthy();
    expect((primary.querySelector("[style]") as HTMLElement).style.background).toBe("rgb(0, 17, 51)");
    await user.click(primary);
    await user.click(screen.getByRole("button", { name: "Primary picker" }));
    await user.click(screen.getByRole("button", { name: "Use rgba(128, 128, 128, 0.502)" }));
    expect(within(primary).getByText("rgba(128, 128, 128, 0.502)")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Primary opacity" }).getAttribute("aria-valuetext")).toBe("50%");
  });
});
