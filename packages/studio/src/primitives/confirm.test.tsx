import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConfirm } from "./confirm";

function Harness({ onAnswer }: Readonly<{ onAnswer: (ok: boolean) => void }>) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button onClick={() => void confirm({ title: "Delete it?", description: "Gone for good.", confirmLabel: "Delete", destructive: true }).then(onAnswer)}>
        Ask
      </button>
      {dialog}
    </>
  );
}

describe("useConfirm", () => {
  afterEach(cleanup);

  it("resolves true on the confirm button", async () => {
    const answers: boolean[] = [];
    render(<Harness onAnswer={(ok) => answers.push(ok)} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Ask"));
    expect(screen.getByRole("alertdialog", { name: "Delete it?" })).toBeTruthy();
    expect(screen.getByText("Gone for good.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(answers).toEqual([true]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("resolves false on Cancel and on Escape, and focus goes back to the opener", async () => {
    const answers: boolean[] = [];
    render(<Harness onAnswer={(ok) => answers.push(ok)} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Ask"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByText("Ask"));
    await user.keyboard("{Escape}");
    expect(answers).toEqual([false, false]);
    expect(document.activeElement).toBe(screen.getByText("Ask"));
  });
});
