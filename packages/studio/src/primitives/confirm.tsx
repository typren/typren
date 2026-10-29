import { useCallback, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./alert-dialog";
import { Button } from "./button";
import { usePortal } from "./portal";

export type ConfirmOptions = {
  title: string;
  /** Plain text, or richer content such as the pages an asset is used on. */
  description?: ReactNode;
  confirmLabel?: string;
  /** Styles the confirm button as the destructive action. */
  destructive?: boolean;
};

/** The studio's one confirmation: `await confirm({...})` resolves true on the
 *  confirm button and false on Cancel, Escape or a click outside, in place of a
 *  native `confirm()`. Render the returned `dialog` once beside the component
 *  that asks, so it mounts inside the Frame and keeps its theme scope. Base UI
 *  traps focus in it and returns focus to the control that opened it; focus
 *  starts on Cancel, so a stray Enter never confirms a destructive action. */
export function useConfirm() {
  const [req, setReq] = useState<(ConfirmOptions & { settle: (ok: boolean) => void }) | null>(null);
  const portal = usePortal();
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((settle) => setReq({ ...o, settle })), []);
  const answer = (ok: boolean) => {
    req?.settle(ok);
    setReq(null);
  };
  const dialog = (
    <AlertDialog open={req !== null} onOpenChange={(o) => !o && answer(false)}>
      <AlertDialogContent container={portal ?? undefined}>
        <AlertDialogTitle>{req?.title}</AlertDialogTitle>
        {req?.description && <AlertDialogDescription>{req.description}</AlertDialogDescription>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant={req?.destructive ? "destructive" : "default"} onClick={() => answer(true)}>
            {req?.confirmLabel ?? "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, dialog };
}
