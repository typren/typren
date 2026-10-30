import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "./menu";

afterEach(cleanup);

describe("Menu", () => {
  it("opens from its trigger and fires the chosen item", async () => {
    const onSelect = vi.fn();
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent>
          <MenuItem onClick={onSelect}>Rename</MenuItem>
          <MenuItem variant="destructive">Delete</MenuItem>
        </MenuContent>
      </Menu>,
    );
    expect(screen.queryByText("Rename")).toBeNull();
    await userEvent.setup().click(screen.getByText("Actions"));
    expect((await screen.findByText("Delete")).className).toContain("text-[var(--typren-destructive)]");
    await userEvent.click(await screen.findByText("Rename"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("renders a group label and a separator", async () => {
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent>
          <MenuGroup>
            <MenuLabel>Account</MenuLabel>
            <MenuItem>Rename</MenuItem>
          </MenuGroup>
          <MenuSeparator />
        </MenuContent>
      </Menu>,
    );
    await userEvent.setup().click(screen.getByText("Actions"));
    expect(await screen.findByText("Account")).toBeTruthy();
    expect(document.querySelector("[data-slot=menu-separator]")).not.toBeNull();
  });
});
