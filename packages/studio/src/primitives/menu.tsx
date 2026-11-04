import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn, popupMotion } from "./cn";
import { usePortal } from "./portal";

/** Click-to-open menu (shadcn DropdownMenu): the same popup and item look as
 *  `ContextMenu`, trimmed to the parts hosts use. */
function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />;
}

function MenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />;
}

function MenuContent({
  className,
  align = "end",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal container={usePortal() ?? undefined}>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="isolate z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            popupMotion,
            "typren-surface-2 z-50 min-w-36 rounded-[var(--typren-radius-control)] bg-[var(--typren-popover)] p-1 text-sm text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)] outline-none",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuItem({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 typren-concentric px-2 py-1.5 outline-none select-none data-highlighted:bg-[var(--typren-fill-subtle-hover)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4",
        variant === "destructive" && "text-[var(--typren-destructive)]",
        className
      )}
      {...props}
    />
  );
}

/** Wraps a `MenuLabel` and its items; Base UI's label needs the group. */
function MenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

function MenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menu-label"
      className={cn("px-2 py-1.5 text-xs text-[var(--typren-muted-fg)]", className)}
      {...props}
    />
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      className={cn("-mx-1 my-1 h-px bg-[var(--typren-border)]", className)}
      {...props}
    />
  );
}

export { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger };
