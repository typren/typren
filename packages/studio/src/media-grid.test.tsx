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
