import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@typren/core";
import type { FieldFormMedia } from "./image-picker-field";
import { MediaLibrarySection } from "./media-library";

afterEach(cleanup);

const asset: MediaAsset = { id: "a1", url: "/img/a1.webp", name: "hero.webp", size: 1024, mime: "image/webp", createdAt: "2026-01-01" };

describe("MediaLibrarySection", () => {
  it("renders a not-configured message when no media adapter is wired", () => {
    render(<MediaLibrarySection />);
    expect(screen.getByText(/isn.t configured/)).toBeTruthy();
  });

  it("lists assets from media.list() on mount", async () => {
    const media: FieldFormMedia = { list: vi.fn(async () => [asset]), delete: vi.fn(), uploadPath: "/upload" };
    render(<MediaLibrarySection media={media} />);
    expect(await screen.findByText("hero.webp")).toBeTruthy();
    expect(media.list).toHaveBeenCalledTimes(1);
  });

  it("confirming delete calls media.delete with the asset id", async () => {
    const media: FieldFormMedia = { list: vi.fn(async () => [asset]), delete: vi.fn(async () => {}), uploadPath: "/upload" };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<MediaLibrarySection media={media} />);
    await screen.findByText("hero.webp");
    await user.click(screen.getByRole("button", { name: "Delete hero.webp" }));
    await waitFor(() => expect(media.delete).toHaveBeenCalledWith("a1"));
    confirmSpy.mockRestore();
  });

  it("declining the confirm leaves the asset alone", async () => {
    const media: FieldFormMedia = { list: vi.fn(async () => [asset]), delete: vi.fn(async () => {}), uploadPath: "/upload" };
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<MediaLibrarySection media={media} />);
    await screen.findByText("hero.webp");
    await user.click(screen.getByRole("button", { name: "Delete hero.webp" }));
    expect(media.delete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
