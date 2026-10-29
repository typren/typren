import type { ComponentProps } from "react";
import { cn } from "./cn";

function Textarea({ className, ...props }: Readonly<ComponentProps<"textarea">>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border border-[var(--typren-border)] bg-[var(--typren-bg)] px-3 py-2 text-sm text-[var(--typren-fg)] shadow-sm outline-none transition-colors placeholder:text-[var(--typren-muted-fg)] focus-visible:border-[var(--typren-ring)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
