import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionRecordInfo, SliceSchema } from "@typren/core";
import { CollectionList, resolveListColumns } from "./collection-list";

afterEach(cleanup);

const schema: SliceSchema = { name: { type: "text" }, role: { type: "text" }, bio: { type: "textarea" } };

describe("resolveListColumns", () => {
  it("defaults primary to titleField, else 'title', else the first key", () => {
    expect(resolveListColumns(schema).primary).toBe("name"); // first key, no "title" present
    expect(resolveListColumns({ title: { type: "text" }, name: { type: "text" } }).primary).toBe("title");
    expect(resolveListColumns(schema, "role").primary).toBe("role");
  });

  it("extra columns default to the first 4 schema keys, primary excluded", () => {
    expect(resolveListColumns(schema).extra).toEqual(["role", "bio"]);
  });
});

const records: CollectionRecordInfo[] = [
  { slug: "ada", meta: { name: "Ada Lovelace", role: "Author" }, body: "", hasDraft: false },
  { slug: "grace", meta: { name: "Grace Hopper", role: "Author" }, body: "", hasDraft: true },
];

describe("CollectionList", () => {
  it("renders a row per record, from data only", () => {
    render(<CollectionList records={records} schema={schema} onSelect={() => {}} />);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
  });

  it("shows the empty state instead of a table when there are no records", () => {
    render(<CollectionList records={[]} schema={schema} onSelect={() => {}} />);
    expect(screen.getByText("No records yet.")).toBeTruthy();
  });

  it("clicking the primary cell calls onSelect with the record's slug", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CollectionList records={records} schema={schema} onSelect={onSelect} />);
    await user.click(screen.getByText("Ada Lovelace"));
    expect(onSelect).toHaveBeenCalledWith("ada");
  });

  it("omitting onDelete renders no delete controls (read-only degrade)", () => {
    render(<CollectionList records={records} schema={schema} onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("confirming delete calls onDelete with the slug", async () => {
    const onDelete = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<CollectionList records={records} schema={schema} onSelect={() => {}} onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "Delete ada" }));
    expect(onDelete).toHaveBeenCalledWith("ada");
    confirmSpy.mockRestore();
  });
});
