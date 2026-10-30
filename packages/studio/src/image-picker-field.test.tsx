import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@typren/core";
import { ImagePickerField, SharedMediaProvider } from "./image-picker-field";

afterEach(cleanup);

const asset = (id: string, url: string): MediaAsset => ({ id, name: id, url }) as MediaAsset;
const media = { list: async () => [asset("mine", "/img/mine.webp")], uploadPath: "/up", delete: async () => {} };
const shared = { label: "Shared", list: vi.fn(async () => [asset("logo", "https://cdn.example/logo.webp")]) };

describe("ImagePickerField shared source", () => {
  it("offers no switch without a shared source", async () => {
    render(<ImagePickerField value="" onChange={() => {}} media={media} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "+ Add image" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("group", { name: "Media source" })).toBeNull();
  });

  it("switches to the shared library, picks by url, and offers no upload there", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SharedMediaProvider value={shared}>
        <ImagePickerField value="" onChange={onChange} media={media} />
      </SharedMediaProvider>,
    );
    await user.click(screen.getByRole("button", { name: "+ Add image" }));
    expect(await screen.findByText("Upload")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Shared" }));
    expect(await screen.findByAltText("logo")).toBeTruthy();
    expect(screen.queryByText("Upload")).toBeNull();
    await user.click(screen.getByAltText("logo"));
    expect(onChange).toHaveBeenCalledWith("https://cdn.example/logo.webp");
  });
});
