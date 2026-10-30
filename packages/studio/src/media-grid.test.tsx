import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@typren/core";
import { MediaGrid } from "./media-grid";

afterEach(cleanup);

const asset = { id: "a1", name: "logo.webp", url: "/m/logo.webp", size: 2048 } as MediaAsset;
const base = { assets: [asset], mode: "library" as const, onUploadFiles: () => {} };

describe("MediaGrid extraActions", () => {
  it("adds no menu without the prop", () => {
    render(<MediaGrid {...base} />);
    expect(screen.queryByLabelText("More actions for logo.webp")).toBeNull();
  });

  it("lists the host's actions per asset and fires the chosen one", async () => {
    const rename = vi.fn();
    const extraActions = vi.fn((a: MediaAsset) => [{ label: `Rename ${a.name}`, onSelect: rename }]);
    render(<MediaGrid {...base} extraActions={extraActions} />);
    await userEvent.setup().click(screen.getByLabelText("More actions for logo.webp"));
    await userEvent.click(await screen.findByText("Rename logo.webp"));
    expect(extraActions).toHaveBeenCalledWith(asset);
    expect(rename).toHaveBeenCalledOnce();
  });
});

describe("MediaGrid delete and copy", () => {
  it("shows Delete only with onDelete and not readOnly", () => {
    const { rerender } = render(<MediaGrid {...base} />);
    expect(screen.queryByLabelText("Delete logo.webp")).toBeNull();
    rerender(<MediaGrid {...base} onDelete={() => {}} />);
    expect(screen.getByLabelText("Delete logo.webp")).toBeTruthy();
    rerender(<MediaGrid {...base} onDelete={() => {}} readOnly />);
    expect(screen.queryByLabelText("Delete logo.webp")).toBeNull();
  });

  it("copies copyUrl's result, else the asset url", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MediaGrid {...base} copyUrl={(a) => `https://x.test${a.url}`} />);
    await user.click(screen.getByLabelText("Copy logo.webp URL"));
    expect(await navigator.clipboard.readText()).toBe("https://x.test/m/logo.webp");
    rerender(<MediaGrid {...base} />);
    await user.click(screen.getByLabelText("Copy logo.webp URL"));
    expect(await navigator.clipboard.readText()).toBe("/m/logo.webp");
  });
});
