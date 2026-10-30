import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ago, SaveStatus } from "./save-status";

afterEach(cleanup);

describe("ago", () => {
  it("is null under a minute, then counts the largest whole unit", () => {
    const now = Date.UTC(2026, 0, 31);
    expect(ago(now - 59_000, now, "en")).toBeNull();
    expect(ago(now + 5_000, now, "en")).toBeNull();
    expect(ago(now - 2 * 60_000, now, "en")).toBe("2 min. ago");
    expect(ago(now - 3 * 86_400_000, now, "en")).toBe("3 days ago");
  });
});

describe("SaveStatus", () => {
  const label = (props: Partial<Parameters<typeof SaveStatus>[0]>) => {
    render(<SaveStatus state="idle" savedAt={null} drafted={false} {...props} />);
    const text = screen.getByRole("status").textContent;
    cleanup();
    return text;
  };

  it("says what the autosave is doing, and never Saved after a failure", () => {
    const at = Date.now();
    expect(label({})).toBe("Up to date");
    expect(label({ drafted: true })).toBe("Draft saved");
    expect(label({ state: "saving", savedAt: at })).toBe("Saving…");
    expect(label({ state: "saved", savedAt: at })).toBe("Saved just now");
    expect(label({ state: "error", savedAt: at })).toBe("Not saved");
    expect(label({ state: "conflict", savedAt: at })).toBe("Not saved: changed elsewhere");
  });

  it("ticks forward while shown", () => {
    vi.useFakeTimers();
    render(<SaveStatus state="saved" savedAt={Date.now()} drafted />);
    expect(screen.getByRole("status").textContent).toBe("Saved just now");
    act(() => void vi.advanceTimersByTime(2 * 60_000));
    expect(screen.getByRole("status").textContent).toBe("Saved 2 min. ago");
    vi.useRealTimers();
  });

  it("says so when the history can't be read, retries on demand, and says when there is none", async () => {
    const iconOf = (title: HTMLElement) => title.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
    const history = vi.fn(() => Promise.reject(new Error("no git")));
    render(<SaveStatus state="idle" savedAt={null} drafted={false} history={history} />);
    act(() => screen.getByRole("button", { name: /Version history/ }).focus());
    expect(iconOf(await screen.findByText("Couldn’t load the history."))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByText("Couldn’t load the history.")).toBeTruthy();
    expect(history).toHaveBeenCalledTimes(2);
    cleanup();
    render(<SaveStatus state="idle" savedAt={null} drafted={false} history={async () => []} />);
    act(() => screen.getByRole("button", { name: /Version history/ }).focus());
    expect(iconOf(await screen.findByText("No versions yet."))).toBeTruthy();
  });

  it("draws the history as a timeline: the draft first, then commits with a wrapped subject, a dated time and the short hash", async () => {
    let resolve: (l: { hash: string; subject: string; author: string; date: string }[]) => void = () => {};
    const subject = "chore(settings): move the settings doc somewhere else entirely, with a long subject";
    const date = new Date(Date.now() - 2 * 86_400_000).toISOString();
    render(<SaveStatus state="saved" savedAt={Date.now()} drafted history={() => new Promise((r) => (resolve = r))} />);
    act(() => screen.getByRole("button", { name: /Version history/ }).focus());
    // Rows of skeleton hold the list's place while it loads.
    expect(await screen.findByRole("heading", { name: "Version history" })).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
    await act(async () => resolve([{ hash: "066f5c6", subject, author: "Ada", date }, { hash: "abc1234", subject: "first", author: "Ada", date }]));
    const items = within(screen.getByRole("list", { name: "Version history" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toBe("Draft · saved just nowNot pushed yet");
    const line = within(items[1]!).getByText(subject);
    expect(line.getAttribute("title")).toBe(subject);
    expect(line.className).toContain("line-clamp-2");
    const time = items[1]!.querySelector("time")!;
    expect(time.getAttribute("dateTime")).toBe(date);
    expect(time.textContent).toBe("2 days ago");
    expect(within(items[1]!).getByText("066f5c6").tagName).toBe("CODE");
    // The rail runs from each node to the next, and stops at the last; the
    // draft's stretch is dashed.
    expect(items[0]!.className).toContain("before:border-dashed");
    expect(items[1]!.className).toContain("before:border-l");
    expect(items[2]!.className).not.toContain("before:");
  });

});
