import { useRef } from "react";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "./cn";
import { useSelectedBox } from "./selection";

/** Vendored shadcn base-nova ToggleGroup on Base UI, trimmed to the single
 *  default look the studio uses: a recessed track (WinUI ControlAltFill)
 *  under an opaque raised thumb, neutral in both themes. The thumb sits under
 *  the pressed item and slides to the next one, so a switch reads as a
 *  movement rather than a jump. It follows the items' `data-pressed`, which covers both
 *  controlled and uncontrolled groups. */
function ToggleGroup({ className, children, ...props }: ToggleGroupPrimitive.Props) {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useSelectedBox(ref, "[data-pressed]", ["data-pressed"]);
  return (
    <ToggleGroupPrimitive
      ref={ref}
      data-slot="toggle-group"
      className={cn(
        "relative flex h-[var(--typren-control-h)] items-center gap-0.5 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-track)] p-1 ring-1 ring-inset ring-[var(--typren-stroke-control)]",
        className
      )}
      {...props}
    >
      {thumb && (
        <span
          aria-hidden
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
          data-slot="toggle-thumb"
          className="typren-selected absolute inset-y-1 left-0 typren-concentric bg-[var(--typren-fill-control-solid)] shadow-(--typren-elevation) transition-[transform,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
        />
      )}
      {children}
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "typren-grain inline-flex h-full w-9 items-center justify-center typren-concentric text-[var(--typren-muted-fg)] cursor-pointer transition-colors duration-300 outline-none hover:text-[var(--typren-fg)] not-data-pressed:hover:bg-[var(--typren-fill-subtle-hover)] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] disabled:pointer-events-none disabled:opacity-50 data-pressed:text-[var(--typren-fg)] data-pressed:after:hidden [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
