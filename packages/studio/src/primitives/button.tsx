import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

/** Vendored shadcn base-nova Button on Base UI. Colors come from the package's
 *  `--typren-*` token contract (see @typren/core's theme.css), so the host maps
 *  it to whatever design system it uses. */
// WinUI's standard Button: a translucent control fill with the elevation
// border, so it reads on the frame and on a panel alike.
const control =
  "typren-grain bg-[var(--typren-fill-control)] text-[var(--typren-fg)] shadow-(--typren-elevation) hover:bg-[var(--typren-fill-control-hover)] active:bg-[var(--typren-fill-control-pressed)] aria-expanded:bg-[var(--typren-fill-control-hover)]";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--typren-radius-control)] border border-transparent bg-clip-padding cursor-pointer text-sm font-medium whitespace-nowrap transition-[background-color,color,border-color,translate] duration-150 motion-reduce:transition-none outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--typren-primary)] text-[var(--typren-primary-fg)] shadow-(--typren-elevation-accent) hover:bg-[var(--typren-fill-accent-hover)] active:bg-[var(--typren-fill-accent-pressed)]",
        secondary: control,
        outline: control,
        ghost:
          "typren-grain text-[var(--typren-muted-fg)] hover:bg-[var(--typren-fill-subtle-hover)] hover:text-[var(--typren-fg)] aria-expanded:bg-[var(--typren-fill-subtle-hover)]",
        destructive: "text-[var(--typren-destructive)] hover:bg-[var(--typren-fill-subtle-hover)]",
      },
      size: {
        default: "h-[var(--typren-control-h)] gap-2 px-4 text-[15px]",
        sm: "h-8 gap-1.5 px-3 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-[var(--typren-control-h)]",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
