import type { ComponentProps } from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Button } from "./button";
import { cn } from "./cn";

/** Vendored shadcn base-nova AlertDialog, trimmed to the parts the studio
 *  uses: `--typren-*` tokens, no animations, and a `container` so the portal
 *  stays in the studio's `.dark` scope. */
function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogContent({
  className,
  container,
  ...props
}: AlertDialogPrimitive.Popup.Props & Pick<AlertDialogPrimitive.Portal.Props, "container">) {
  return (
    <AlertDialogPrimitive.Portal container={container}>
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 isolate z-50 bg-[var(--typren-smoke)] supports-backdrop-filter:backdrop-blur-xs"
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "typren-surface-2 fixed top-1/2 left-1/2 z-50 grid w-full max-w-xs -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--typren-radius-card)] bg-[var(--typren-popover)] p-(--typren-inset-card) text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)] outline-none sm:max-w-sm",
          className
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-(--typren-inset-card) -mb-(--typren-inset-card) flex flex-col-reverse gap-2 rounded-b-[inherit] border-t border-[var(--typren-stroke-divider)] bg-[var(--typren-bg-base)] p-(--typren-inset-card) sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-base font-medium", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-balance text-[var(--typren-muted-fg)]", className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props & Pick<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle };
