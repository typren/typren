import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitOutgoing, GitPendingChange } from "@typren/core";
import { ReviewButton, ReviewPanel, SETTINGS_DRAFT, reviewLabel } from "./review-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pages = [
  { slug: "home", title: "Home" },
  { slug: "about", title: "About us" },
  { slug: "blog/about", title: "Blog about" },
];

const change = (path: string, kind: GitPendingChange["change"] = "modified", subjects = ["content: update"]): GitPendingChange => ({
  path,
  change: kind,
  commits: subjects.map((subject, i) => ({ hash: `h${i}`, subject })),
});

const ahead: GitOutgoing = { branch: "main", upstream: "origin/main", commits: [] };

function makeGit(list: GitPendingChange[], outgoing: GitOutgoing = ahead) {
  return {
    outgoing: vi.fn(async () => outgoing),
    pending: vi.fn(async () => list),
    push: vi.fn<(paths: string[], slugs?: string[]) => Promise<void>>(async () => {}),
    discard: vi.fn<(paths: string[]) => Promise<void>>(async () => {}),
  };
}

function mount(git: ReturnType<typeof makeGit>, props: Partial<Parameters<typeof ReviewPanel>[0]> = {}) {
  const fns = { onClose: vi.fn(), onChanged: vi.fn() };
  render(<ReviewPanel git={git} pages={pages} open {...fns} {...props} />);
  return fns;
}

const iconOf = (title: HTMLElement) => title.closest("[data-slot=empty]")?.querySelector("[data-slot=empty-media] svg");
const box = (name: string | RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const confirmWith = async (name: string) => userEvent.setup().click(within(await screen.findByRole("alertdialog")).getByRole("button", { name }));

describe("reviewLabel", () => {
  it("names pages by title, the site-wide docs by role, and media by file", () => {
    expect(reviewLabel("content/about.md", pages)).toBe("About us");
    expect(reviewLabel("content/blog/about.md", pages)).toBe("Blog about");
    expect(reviewLabel("home.md", pages)).toBe("Home");
    expect(reviewLabel("content/gone.md", pages)).toBe("gone");
    expect(reviewLabel("content/site.md", pages)).toBe("Navigation");
    expect(reviewLabel(".typren/settings.md", pages)).toBe("Site settings");
    expect(reviewLabel("site/.typren/library.md", pages)).toBe("Sections library");
    expect(reviewLabel(".typren/other.md", pages)).toBe("other");
    expect(reviewLabel("typren.config.json", pages)).toBe("Site configuration");
    expect(reviewLabel("public/img/hero.webp", pages)).toBe("hero.webp");
  });
});

describe("ReviewPanel", () => {
  it("lists each pending file with its label, path, kind and commits, all selected", async () => {
    const git = makeGit([change("content/about.md", "modified", ["content: update about", "content: fix typo"]), change("public/img/a.webp", "added")]);
    mount(git, { note: "Changes not yet saved here are not included." });
    expect(await screen.findByRole("dialog", { name: "Review changes" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Changes waiting to push" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("content/about.md")).toBeTruthy();
    expect(within(rows[0]!).getByText("content: update about · content: fix typo")).toBeTruthy();
    expect(within(rows[0]!).getByText("Modified")).toBeTruthy();
    expect(within(rows[1]!).getByText("Added")).toBeTruthy();
    expect(box(/About us/).checked).toBe(true);
    expect(box(/a\.webp/).checked).toBe(true);
    expect(box(/Select all/).checked).toBe(true);
    expect(screen.getByText("Changes not yet saved here are not included.")).toBeTruthy();
  });

  it("select-all goes indeterminate on a partial pick, and toggles every row", async () => {
    const user = userEvent.setup();
    mount(makeGit([change("content/about.md"), change("content/home.md")]));
    await screen.findByRole("list");
    await user.click(box(/About us/));
    expect(box(/Select all/).indeterminate).toBe(true);
    expect(box(/Select all/).checked).toBe(false);
    expect(screen.getByText("Select all (1 of 2)")).toBeTruthy();
    await user.click(box(/Select all/));
    expect(box(/About us/).checked).toBe(true);
    expect(box(/Select all/).indeterminate).toBe(false);
    await user.click(box(/Select all/));
    expect(box(/Home/).checked).toBe(false);
    expect(btn("Push selected").disabled).toBe(true);
    expect(btn("Discard selected").disabled).toBe(true);
  });

  it("pushes the selected paths, then reports and refreshes", async () => {
    const user = userEvent.setup();
    const git = makeGit([change("content/about.md"), change("content/home.md")]);
    const fns = mount(git);
    await screen.findByRole("list");
    await user.click(box(/Home/));
    git.pending.mockResolvedValueOnce([change("content/home.md")]);
    await user.click(btn("Push selected"));
    expect(git.push).toHaveBeenCalledWith(["content/about.md"], []);
    expect(fns.onChanged).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(git.pending).toHaveBeenCalledTimes(2);
    // Home was left unpicked, and stays so.
    expect(box(/Home/).checked).toBe(false);
  });

  it("discards the selection only after the confirm, which says a commit restores it", async () => {
    const user = userEvent.setup();
    const git = makeGit([change("content/about.md"), change("content/home.md")]);
    const fns = mount(git);
    await screen.findByRole("list");
    await user.click(btn("Discard selected"));
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText("Discard 2 changes?")).toBeTruthy();
    expect(ask.textContent).toMatch(/pushed to origin\/main.*new commit that restores them/);
    await confirmWith("Cancel");
    expect(git.discard).not.toHaveBeenCalled();
    git.pending.mockResolvedValueOnce([]);
    await user.click(btn("Discard selected"));
    await confirmWith("Discard");
    await waitFor(() => expect(git.discard).toHaveBeenCalledWith(["content/about.md", "content/home.md"]));
    expect(fns.onChanged).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Nothing waiting to push")).toBeTruthy();
  });

  it("pushes or discards one row from its quick actions", async () => {
    const user = userEvent.setup();
    const git = makeGit([change("content/about.md"), change("content/home.md")]);
    mount(git);
    await screen.findByRole("list");
    await user.click(btn("Push Home"));
    expect(git.push).toHaveBeenCalledWith(["content/home.md"], []);
    await user.click(btn("Discard About us"));
    expect(within(await screen.findByRole("alertdialog")).getByText("Discard About us?")).toBeTruthy();
    await confirmWith("Discard");
    await waitFor(() => expect(git.discard).toHaveBeenCalledWith(["content/about.md"]));
  });

  it("shows core's reason inline on a failure, keeps the selection, and refreshes on demand", async () => {
    const user = userEvent.setup();
    const git = makeGit([change("content/about.md"), change("content/home.md")]);
    git.push.mockRejectedValueOnce(new Error("Your branch is behind its upstream. Pull the latest changes, then try again."));
    const fns = mount(git);
    await screen.findByRole("list");
    await user.click(box(/Home/));
    await user.click(btn("Push selected"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t push");
    expect(alert.textContent).toContain("Pull the latest changes");
    expect(fns.onChanged).not.toHaveBeenCalled();
    expect(box(/About us/).checked).toBe(true);
    expect(box(/Home/).checked).toBe(false);
    await user.click(within(alert).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(git.pending).toHaveBeenCalledTimes(2);
    expect(box(/Home/).checked).toBe(false);

    git.discard.mockRejectedValueOnce(new Error("Someone pushed first. Pull their changes, then push again."));
    await user.click(btn("Discard selected"));
    await confirmWith("Discard");
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t discard");
  });

  it("says when loading fails", async () => {
    const git = makeGit([]);
    git.pending.mockRejectedValueOnce(new Error("offline"));
    mount(git);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load your changes");
    expect(alert.textContent).toContain("offline");
    expect(screen.queryByText("Nothing waiting to push")).toBeNull();
    git.pending.mockResolvedValueOnce([change("content/about.md")]);
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Refresh" }));
    expect((await screen.findByRole("checkbox", { name: /About us/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("explains an empty list, a branch without upstream and a detached HEAD, with only Close", async () => {
    const user = userEvent.setup();
    const git = makeGit([]);
    const fns = mount(git);
    expect(iconOf(await screen.findByText("Nothing waiting to push"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Push selected" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.click(btn("Refresh"));
    await waitFor(() => expect(git.pending).toHaveBeenCalledTimes(2));
    await user.click(btn("Close"));
    expect(fns.onClose).toHaveBeenCalled();
    cleanup();

    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mount(makeGit([], { branch: "wip", upstream: null, commits: [] }));
    expect(iconOf(await screen.findByText("Nowhere to push"))).toBeTruthy();
    expect(screen.getByText(/wip has no upstream/)).toBeTruthy();
    expect(screen.getByText("git push -u origin wip").tagName).toBe("CODE");
    await user.click(btn("Copy"));
    expect(writeText).toHaveBeenCalledWith("git push -u origin wip");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    cleanup();

    mount(makeGit([], { branch: "", upstream: null, commits: [] }));
    expect(iconOf(await screen.findByText("Saving is off"))).toBeTruthy();
    expect(screen.getByText("Check out a branch in your site folder to save.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("locks while busy, so Escape does not close it mid-push", async () => {
    const user = userEvent.setup();
    const git = makeGit([change("content/about.md")]);
    let finish = () => {};
    git.push.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    const fns = mount(git);
    await screen.findByRole("list");
    await user.click(btn("Push selected"));
    expect(btn("Close").disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(fns.onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(btn("Close").disabled).toBe(false));
    await user.keyboard("{Escape}");
    expect(fns.onClose).toHaveBeenCalled();
  });

  it("is a bottom sheet on a phone", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width"), addEventListener() {}, removeEventListener() {} }));
    mount(makeGit([change("content/about.md")]));
    const sheet = await screen.findByRole("dialog", { name: "Review changes" });
    expect(sheet.getAttribute("data-slot")).toBe("sheet");
    expect(await within(sheet).findByRole("checkbox", { name: /About us/ })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Push selected" })).toBeTruthy();
  });

  it("lists drafted pages first, pushes them by slug with files by path, and drops a draft on discard", async () => {
    const user = userEvent.setup();
    const git = makeGit([change("public/img/a.webp", "added")]);
    const onDiscardDraft = vi.fn(async () => {});
    const drafts = [
      { slug: "about", title: "About us" },
      { slug: "faq", title: "FAQ" },
      { slug: SETTINGS_DRAFT, title: "Site settings", detail: "Settings and Style" },
    ];
    mount(git, { drafts: async () => drafts, onDiscardDraft });
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Draft")).toBeTruthy();
    expect(within(rows[0]!).getByText("/about")).toBeTruthy();
    expect(within(rows[2]!).getByText("Settings and Style")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Discard FAQ" }));
    await confirmWith("Discard");
    await waitFor(() => expect(onDiscardDraft).toHaveBeenCalledWith("faq"));
    expect(git.discard).not.toHaveBeenCalled();
    // A draft acted on leaves the list though the host still lists it.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard FAQ" })).toBeNull());
    await user.click(btn("Push selected"));
    await waitFor(() => expect(git.push).toHaveBeenCalledWith(["public/img/a.webp"], ["about"], true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Discard About us" })).toBeNull());
  });

  it("pushes page drafts alone without the settings flag", async () => {
    const git = makeGit([]);
    mount(git, { drafts: async () => [{ slug: "about", title: "About us" }] });
    await screen.findByRole("list");
    await userEvent.setup().click(btn("Push selected"));
    await waitFor(() => expect(git.push).toHaveBeenCalledWith([], ["about"]));
  });

  it("still lists files when drafts cannot be read", async () => {
    mount(makeGit([change("content/home.md")]), { drafts: () => Promise.reject(new Error("nope")) });
    expect(within(await screen.findByRole("list")).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("ReviewButton", () => {
  it("is off with its reason in a focusable tooltip until there is something to review", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<ReviewButton reason="Nothing to review yet." onClick={onClick} />);
    expect(btn("Review").disabled).toBe(true);
    const trigger = screen.getByLabelText("Review: Nothing to review yet.");
    expect(trigger.tabIndex).toBe(0);
    rerender(<ReviewButton reason="" onClick={onClick} />);
    await userEvent.setup().click(btn("Review"));
    expect(onClick).toHaveBeenCalled();
  });
});
