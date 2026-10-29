import type { ComponentProps } from "react";
import { cn } from "./cn";

function Input({ className, ...props }: Readonly<ComponentProps<"input">>) {
  return (
    <input
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-md border border-[var(--typren-border)] bg-[var(--typren-bg)] px-3 py-1 text-sm text-[var(--typren-fg)] shadow-sm outline-none transition-colors placeholder:text-[var(--typren-muted-fg)] focus-visible:border-[var(--typren-ring)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };
