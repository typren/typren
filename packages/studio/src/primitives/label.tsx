import type { ComponentProps } from "react";
import { cn } from "./cn";

function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "mb-1 flex items-center gap-2 text-xs leading-none font-medium text-[var(--typren-muted-fg)] select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Label };
