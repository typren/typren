import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { withToken } from "./style-parts";
import type { StyleScreenProps } from "./style-parts";
import { ShapeScreen } from "./style-shape";
import { FONT_PRESETS, TypeScreen, headingSizes, toPx } from "./style-type";

afterEach(cleanup);

function Harness({ Screen, initial = {} }: Readonly<{ Screen: ComponentType<StyleScreenProps>; initial?: Record<string, string> }>) {
  const [style, setStyle] = useState(initial);
  return <Screen style={style} set={(n, v) => setStyle((s) => withToken(s, n, v))} />;
}

describe("type maths", () => {
  it("reads px, rem and em, and nothing else", () => {
    expect(toPx("18px")).toBe(18);
    expect(toPx("1.125rem")).toBe(18);
    expect(toPx(".5em")).toBe(8);
    expect(toPx("clamp(1rem, 2vw, 2rem)")).toBeNull();
    expect(toPx(undefined)).toBeNull();
  });

  it("steps the headings up from the base size by the scale", () => {
    expect(headingSizes({ "--typren-font-size": "10px", "--typren-type-scale": "2" }).map((h) => h.px)).toEqual([160, 80, 40, 20]);
    expect(headingSizes({ "--typren-type-scale": "nope" })[3]!.px).toBe(20);
  });
});

describe("TypeScreen", () => {
  it("shows the specimen at its sizes and says what is not set", () => {
    render(<Harness Screen={TypeScreen} initial={{ "--typren-font-size": "20px", "--typren-line-height": "1.6" }} />);
    const body = screen.getByRole("option", { name: "Body" });
    expect(within(body).getByText("20px / 1.6")).toBeTruthy();
    expect(within(screen.getByRole("option", { name: "Headings" })).getByText("H1 · 49px / 1.2")).toBeTruthy();
    expect(within(screen.getByRole("option", { name: "Headings" })).getByText("Not set (shown at 1.25)")).toBeTruthy();
  });

  it("edits the heading font, scale and line height from the side panel", async () => {
    const user = userEvent.setup();
    render(<Harness Screen={TypeScreen} />);
    await user.click(screen.getByRole("option", { name: "Headings" }));
    const panel = screen.getByRole("complementary", { name: "Headings settings" });
    await user.click(within(panel).getByRole("button", { name: /Mono/ }));
    expect(within(panel).getByRole("textbox", { name: "Heading font" })).toHaveProperty("value", FONT_PRESETS[3].value);
    expect(within(panel).getByRole("button", { name: /Mono/ }).getAttribute("aria-pressed")).toBe("true");
    await user.type(within(panel).getByRole("textbox", { name: "Type scale" }), "2");
    expect(within(screen.getByRole("option", { name: "Headings" })).getByText("H4 · 32px / 1.2")).toBeTruthy();
    await user.type(within(panel).getByRole("textbox", { name: "Heading line height" }), "1.1");
    await user.click(within(panel).getByRole("button", { name: "Reset to default" }));
    expect(within(panel).getByRole("textbox", { name: "Type scale" })).toHaveProperty("value", "");
    expect(within(panel).getByRole("button", { name: "Reset to default" })).toHaveProperty("disabled", true);
  });

  it("edits the body size and line height", async () => {
    const user = userEvent.setup();
    render(<Harness Screen={TypeScreen} />);
    await user.click(screen.getByRole("option", { name: "Body" }));
    const panel = screen.getByRole("complementary", { name: "Body settings" });
    await user.type(within(panel).getByRole("textbox", { name: "Base font size" }), "18px");
    await user.type(within(panel).getByRole("textbox", { name: "Body line height" }), "1.7");
    expect(within(screen.getByRole("option", { name: "Body" })).getByText("18px / 1.7")).toBeTruthy();
  });
});

describe("ShapeScreen", () => {
  it("draws radius and spacing and edits them with presets", async () => {
    const user = userEvent.setup();
    render(<Harness Screen={ShapeScreen} />);
    expect(within(screen.getByRole("option", { name: "Corner radius" })).getByText("Not set (shown at 0)")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Corner radius" }));
    await user.click(screen.getByRole("button", { name: "Round" }));
    expect(within(screen.getByRole("option", { name: "Corner radius" })).getByText("8px")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Base spacing" }));
    await user.click(screen.getByRole("button", { name: "Airy" }));
    expect(within(screen.getByRole("option", { name: "Base spacing" })).getByText("1.5rem")).toBeTruthy();
  });

  it("shows the site preview in place of the gallery when given one", () => {
    render(<ShapeScreen style={{}} set={() => {}} stage={<p>site</p>} preview />);
    expect(screen.getByText("site")).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
