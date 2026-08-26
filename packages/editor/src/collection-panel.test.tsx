import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionRecordInfo, CollectionSection, PageActions } from "@typren/core";
import { CollectionPanel } from "./collection-panel";

afterEach(cleanup);

const section: CollectionSection = {
  kind: "collection",
  label: "Authors",
  dir: "content/authors",
  schema: { name: { type: "text" } },
};

const records: CollectionRecordInfo[] = [{ slug: "ada", meta: { name: "Ada Lovelace" }, body: "", hasDraft: false }];

function makeActions(): PageActions {
  return {
    createPage: vi.fn(async () => "grace"),
    deletePage: vi.fn(async () => {}),
    saveDraft: vi.fn(async () => ({ ok: true as const, version: "v1" })),
    publish: vi.fn(async () => ({ ok: true as const, version: "v1" })),
    discardDraft: vi.fn(async () => {}),
    createTranslation: vi.fn(async () => {}),
    deleteTranslation: vi.fn(async () => {}),
  } as unknown as PageActions;
}

describe("CollectionPanel", () => {
  it("lists records from the `records` data prop", () => {
    render(<CollectionPanel section={section} records={records} onReload={() => {}} />);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("without `actions`, list renders read-only: no delete column, disabled New", () => {
    render(<CollectionPanel section={section} records={records} onReload={() => {}} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect((screen.getByRole("button", { name: "New Authors" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("create flow: createPage, then saveDraft+publish the primary field, then reload", async () => {
    const actions = makeActions();
    const onReload = vi.fn();
    const user = userEvent.setup();
    render(<CollectionPanel section={section} actions={actions} records={records} onReload={onReload} />);

    await user.click(screen.getByRole("button", { name: "New Authors" }));
    await user.type(screen.getByPlaceholderText("name"), "Grace Hopper");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(actions.createPage).toHaveBeenCalledWith("Grace Hopper", undefined);
    expect(actions.saveDraft).toHaveBeenCalledWith(
      "grace",
      { meta: { name: "Grace Hopper" }, slices: [], body: "" },
      undefined,
      undefined
    );
    expect(actions.publish).toHaveBeenCalledWith("grace", undefined, undefined);
  });

  it("delete flow: confirming calls actions.deletePage and reloads", async () => {
    const actions = makeActions();
    const onReload = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<CollectionPanel section={section} actions={actions} records={records} onReload={onReload} />);

    await user.click(screen.getByRole("button", { name: "Delete ada" }));
    await waitFor(() => expect(actions.deletePage).toHaveBeenCalledWith("ada"));
    expect(onReload).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("edit flow: opening a record, editing a field, and saving publishes it", async () => {
    const actions = makeActions();
    const onReload = vi.fn();
    const user = userEvent.setup();
    render(<CollectionPanel section={section} actions={actions} records={records} onReload={onReload} />);

    await user.click(screen.getByText("Ada Lovelace"));
    const nameField = screen.getByDisplayValue("Ada Lovelace");
    await user.clear(nameField);
    await user.type(nameField, "Ada L.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(actions.saveDraft).toHaveBeenCalledWith("ada", { meta: { name: "Ada L." }, slices: [], body: "" }, undefined, undefined);
    expect(actions.publish).toHaveBeenCalledWith("ada", undefined, undefined);
  });
});
