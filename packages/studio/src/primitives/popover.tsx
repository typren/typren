import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn, popupMotion } from "./cn";

/** Vendored shadcn base-nova Popover, trimmed to the parts the studio uses.
 *  Token classes map to `--typren-*`, and the enter/exit animations are
 *  dropped (they need tw-animate-css in the host). `container` keeps the
 *  portal inside the studio's own `.dark` scope. */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  container,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> &
  Pick<PopoverPrimitive.Portal.Props, "container">) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            popupMotion,
            "typren-surface-2 z-50 flex w-72 flex-col gap-2.5 rounded-[var(--typren-radius-card)] bg-[var(--typren-popover)] p-(--typren-inset-card) text-sm text-[var(--typren-popover-fg)] shadow-(--typren-shadow-flyout) ring-1 ring-[var(--typren-stroke-flyout)] outline-hidden",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
