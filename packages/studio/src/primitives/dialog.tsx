import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "./cn";
import { usePortal } from "./portal";

/** Vendored shadcn base-nova Dialog, trimmed to the parts the studio uses:
 *  `--typren-*` tokens, no animations, and the portal lands inside the Frame
 *  (see `portal.tsx`) unless a `container` is given. */
function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogContent({
  className,
  container,
  ...props
}: DialogPrimitive.Popup.Props & Pick<DialogPrimitive.Portal.Props, "container">) {
  const portal = usePortal();
  return (
    <DialogPrimitive.Portal container={container ?? portal ?? undefined}>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className="fixed inset-0 isolate z-50 bg-[var(--typren-smoke)] supports-backdrop-filter:backdrop-blur-xs"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "typren-surface-2 fixed top-1/2 left-1/2 z-50 grid w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--typren-radius-card)] bg-[var(--typren-popover)] p-(--typren-inset-card) text-sm text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)] outline-none",
          className
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex justify-end gap-2", className)} {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger };
