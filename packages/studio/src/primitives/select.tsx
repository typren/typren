import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn, popupMotion } from "./cn";
import { ScrollArea } from "./scroll-area";
import { usePortal } from "./portal";

/** Vendored shadcn base-nova Select on Base UI, trimmed to the parts the
 *  studio uses. `--typren-*` tokens, no animations, and the popup portals into
 *  the Frame (see `portal.tsx`) unless a `container` is given. */
const Select = SelectPrimitive.Root;

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 truncate text-left", className)}
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-[var(--typren-control-h)] w-full items-center justify-between gap-1.5 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] shadow-(--typren-elevation) py-2 pr-2.5 pl-3.5 text-sm whitespace-nowrap text-[var(--typren-fg)] cursor-pointer transition-colors duration-150 motion-reduce:transition-none outline-none select-none hover:bg-[var(--typren-fill-control-hover)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-[var(--typren-muted-fg)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDown className="size-3.5 text-[var(--typren-muted-fg)]" />
        }
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  container,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, "align" | "side" | "sideOffset"> &
  Pick<SelectPrimitive.Portal.Props, "container">) {
  const portal = usePortal();
  return (
    <SelectPrimitive.Portal container={container ?? portal ?? undefined}>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignItemWithTrigger={false}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            popupMotion,
            "typren-surface-2 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 overflow-hidden rounded-[var(--typren-radius-control)] bg-[var(--typren-popover)] text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)]",
            className,
          )}
          {...props}
        >
          <ScrollArea
            className="max-h-[inherit]"
            viewportClassName="h-auto max-h-[inherit] p-1"
          >
            <SelectPrimitive.List>{children}</SelectPrimitive.List>
          </ScrollArea>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 typren-concentric py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-[var(--typren-fill-subtle-hover)] data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <Check className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
