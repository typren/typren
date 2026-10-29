import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";

/** The top bar's one button look, the WinUI standard button at control
 *  height: square when icon-only. With `label` it reads as text from md up
 *  and, below, turns into the same square holding `children` (its icon).
 *  As a toggle (`aria-pressed`) its pressed state is the selection fill.
 *  Inside a `group/actions` marked `data-morphed` it is the square from md
 *  up too. */
export function TopBarButton({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size"> & { label?: string; children?: ReactNode }) {
  const pressed = "aria-pressed:bg-[var(--typren-fill-subtle-selected)] aria-pressed:shadow-none aria-pressed:hover:bg-[var(--typren-fill-subtle-selected)]";
  if (!label)
    return (
      <Button variant="secondary" size="icon" className={cn(pressed, className)} {...props}>
        {children}
      </Button>
    );
  return (
    <Button
      variant="secondary"
      className={cn(
        pressed,
        "max-md:size-[var(--typren-control-h)] max-md:px-0",
        // Folded to its icon where Frame's ActionMorph has grown the edit toolbar out of it.
        "md:group-data-morphed/actions:size-[var(--typren-control-h)] md:group-data-morphed/actions:px-0",
        className,
      )}
      {...props}
    >
      <span className="contents md:hidden md:group-data-morphed/actions:contents">{children}</span>
      <span className="max-md:sr-only md:group-data-morphed/actions:sr-only">{label}</span>
    </Button>
  );
}
