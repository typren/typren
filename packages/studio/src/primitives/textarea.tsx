import type { ComponentProps } from "react";
import { cn } from "./cn";

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] shadow-(--typren-elevation-input) px-3.5 py-2.5 text-[15px] text-[var(--typren-fg)] transition-colors duration-150 motion-reduce:transition-none outline-none hover:bg-[var(--typren-fill-control-hover)] placeholder:text-[var(--typren-muted-fg)] focus-visible:bg-[var(--typren-fill-control-input)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
