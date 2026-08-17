import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

/** Vendored shadcn Button. Colors come from the package's `--typren-*` token
 *  contract (see @typren/core's theme.css), so the host maps it to whatever
 *  design system it uses. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[var(--typren-primary)] text-[var(--typren-primary-fg)] hover:opacity-90",
        secondary: "bg-[var(--typren-muted)] text-[var(--typren-fg)] hover:opacity-80",
        outline:
          "border border-[var(--typren-border)] bg-[var(--typren-bg)] text-[var(--typren-fg)] hover:bg-[var(--typren-muted)]",
        ghost: "text-[var(--typren-muted-fg)] hover:bg-[var(--typren-muted)] hover:text-[var(--typren-fg)]",
        destructive: "text-[var(--typren-destructive)] hover:bg-[var(--typren-muted)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant,
  size,
  ...props
}: Readonly<ComponentProps<"button"> & VariantProps<typeof buttonVariants>>) {
  return (
    <button data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}

export { Button, buttonVariants };
