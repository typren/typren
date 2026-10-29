import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn, popupMotion } from "./cn";
import { usePortal } from "./portal";

/** Vendored shadcn base-nova ContextMenu, trimmed to the parts the studio
 *  uses. Portals into the Frame root so it keeps the studio's `.dark` scope. */
function ContextMenu(props: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger(props: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal container={usePortal()}>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            popupMotion,
            "typren-surface-2 z-50 min-w-36 rounded-[var(--typren-radius-control)] bg-[var(--typren-popover)] p-1 text-sm text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)] outline-none",
            className
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: ContextMenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 typren-concentric px-2 py-1.5 outline-none select-none data-highlighted:bg-[var(--typren-fill-subtle-hover)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4",
        variant === "destructive" && "text-[var(--typren-destructive)]",
        className
      )}
      {...props}
    />
  );
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger };
