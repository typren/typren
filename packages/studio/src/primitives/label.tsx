import type { ComponentProps } from "react";
import { cn } from "./cn";

function Label({ className, ...props }: Readonly<ComponentProps<"label">>) {
  return (
    <label
      data-slot="label"
      className={cn("mb-1 block text-xs font-medium text-[var(--typren-muted-fg)]", className)}
      {...props}
    />
  );
}

export { Label };
