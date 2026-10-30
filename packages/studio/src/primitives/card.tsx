import type { ComponentProps } from "react";
import { cn } from "./cn";

/** A host-page card in the studio's panel look (the studio's own `Panel` is a
 *  flex-filling shell region, so it can't serve as a card). */
function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "typren-surface-1 flex flex-col gap-4 rounded-[var(--typren-radius-card)] border border-[var(--typren-stroke-card)] bg-[var(--typren-layer)] p-5 text-[var(--typren-fg)]",
        className
      )}
      {...props}
    />
  );
}

const CardHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-header" className={cn("flex flex-col gap-1", className)} {...props} />
);
const CardTitle = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-title" className={cn("text-base font-semibold", className)} {...props} />
);
const CardDescription = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-description" className={cn("text-sm text-[var(--typren-muted-fg)]", className)} {...props} />
);
const CardContent = (props: ComponentProps<"div">) => <div data-slot="card-content" {...props} />;
const CardFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-footer" className={cn("flex items-center gap-2", className)} {...props} />
);

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
