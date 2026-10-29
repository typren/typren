import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorPicker, rgbaHex, toHsva, toRgba, type Rgba } from "./color-picker";

afterEach(cleanup);

describe("colour model", () => {
  it("round-trips rgb through hsv", () => {
    for (const c of [[255, 0, 0, 1], [0, 128, 255, 1], [18, 52, 86, 0.5], [0, 0, 0, 1], [255, 255, 255, 1], [200, 0, 200, 1], [10, 200, 30, 1]] as Rgba[]) {
      expect(toRgba(toHsva(c))).toEqual(c);
    }
    expect(toHsva([0, 0, 255, 1])).toEqual({ h: 240, s: 100, v: 100, a: 100 });
  });

  it("writes hex, with alpha only when not opaque", () => {
    expect(rgbaHex([255, 0, 16, 1])).toBe("#ff0010");
    expect(rgbaHex([255, 0, 16, 0.5])).toBe("#ff001080");
  });
});

function Harness({ initial, onChange = () => {}, presets }: Readonly<{ initial: Rgba | null; onChange?: (v: string) => void; presets?: string[] }>) {
  const [color, setColor] = useState(initial);
  return (
    <>
      <ColorPicker
        label="Ink"
        color={color}
        presets={presets}
        onChange={(v) => {
          onChange(v);
          if (!v.startsWith("#")) return;
          const n = v.match(/[0-9a-f]{2}/gi)!.map((h) => parseInt(h, 16));
          setColor([n[0]!, n[1]!, n[2]!, n[3] === undefined ? 1 : n[3] / 255]);
        }}
      />
      <button type="button" onClick={() => setColor([0, 0, 255, 1])}>
        outside
      </button>
    </>
  );
}

const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ink picker" }));
  return user;
};

describe("ColorPicker", () => {
  it("opens with focus in the area, and moves it by keyboard, Shift by 10", async () => {
    const onChange = vi.fn();
    render(<Harness initial={[255, 0, 0, 1]} onChange={onChange} />);
    const user = await open();
    const area = screen.getByRole("slider", { name: "Ink saturation and brightness" });
    expect(document.activeElement).toBe(area);
    expect(area.getAttribute("aria-valuetext")).toBe("Saturation 100%, brightness 100%");
    await user.keyboard("{ArrowLeft}");
    expect(area.getAttribute("aria-valuetext")).toBe("Saturation 99%, brightness 100%");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(area.getAttribute("aria-valuetext")).toBe("Saturation 99%, brightness 90%");
    await user.keyboard("{Shift>}{ArrowRight}{ArrowUp}{/Shift}");
    expect(area.getAttribute("aria-valuetext")).toBe("Saturation 100%, brightness 100%");
    await user.keyboard("a");
    expect(onChange).toHaveBeenLastCalledWith("#ff0000");
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("drags in the area with a pointer", async () => {
    const onChange = vi.fn();
    render(<Harness initial={[255, 0, 0, 1]} onChange={onChange} />);
    await open();
    const area = screen.getByRole("slider", { name: "Ink saturation and brightness" });
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    fireEvent.pointerDown(area, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith("#804040");
    fireEvent.pointerMove(area, { clientX: 400, clientY: -10, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith("#ff0000");
    fireEvent.pointerUp(area, { pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: 0, clientY: 100, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("steps hue and opacity on their sliders, with value text", async () => {
    const onChange = vi.fn();
    render(<Harness initial={[255, 0, 0, 1]} onChange={onChange} />);
    const user = await open();
    const hue = screen.getByRole("slider", { name: "Ink hue" });
    expect(hue.getAttribute("aria-valuetext")).toBe("0 degrees");
    act(() => hue.focus());
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(screen.getByRole("slider", { name: "Ink hue" }).getAttribute("aria-valuetext")).toBe("10 degrees");
    expect(onChange).toHaveBeenLastCalledWith("#ff2a00");
    const alpha = screen.getByRole("slider", { name: "Ink opacity" });
    expect(alpha.getAttribute("aria-valuetext")).toBe("100%");
    act(() => alpha.focus());
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("#ff2a00fc");
  });

  it("keeps its hue through grey, and resets for a value from outside", async () => {
    render(<Harness initial={[0, 255, 0, 1]} />);
    const user = await open();
    await user.keyboard("{Shift>}{ArrowLeft>10/}{/Shift}");
    expect(screen.getByRole("slider", { name: "Ink hue" }).getAttribute("aria-valuetext")).toBe("120 degrees");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "outside" }));
    await user.click(screen.getByRole("button", { name: "Ink picker" }));
    expect(screen.getByRole("slider", { name: "Ink hue" }).getAttribute("aria-valuetext")).toBe("240 degrees");
  });

  it("starts from black with no colour, offers presets, and closes on Escape alone", async () => {
    const onChange = vi.fn();
    const parentKey = vi.fn();
    render(
      <div onKeyDown={(e) => parentKey(e.key)}>
        <Harness initial={null} onChange={onChange} presets={["rgb(1, 2, 3)"]} />
      </div>
    );
    const user = await open();
    expect(screen.getByRole("slider", { name: "Ink saturation and brightness" }).getAttribute("aria-valuetext")).toBe("Saturation 0%, brightness 0%");
    await user.click(screen.getByRole("button", { name: "Use rgb(1, 2, 3)" }));
    expect(onChange).toHaveBeenLastCalledWith("rgb(1, 2, 3)");
    act(() => screen.getByRole("slider", { name: "Ink saturation and brightness" }).focus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("slider", { name: "Ink hue" })).toBeNull();
    expect(parentKey).not.toHaveBeenCalledWith("Escape");
  });
});

describe("ColorPicker popover name", () => {
  it("names its dialog after the colour", async () => {
    render(<Harness initial={[0, 0, 0, 1]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Ink picker" }));
    expect(await screen.findByRole("dialog", { name: "Ink colour picker" })).toBeTruthy();
  });
});
