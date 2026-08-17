import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

/** shadcn-styled native select — most accessible option, no extra primitive
 *  library. Lucide chevron for the shadcn look. */
function Select({ className, children, ...props }: Readonly<ComponentProps<"select">>) {
  return (
    <div className="relative inline-flex items-center">
      <select
        data-slot="select"
        className={cn(
          "h-8 w-full appearance-none rounded-md border border-[var(--typren-border)] bg-[var(--typren-bg)] pl-2.5 pr-7 text-xs text-[var(--typren-fg)] shadow-sm outline-none focus-visible:border-[var(--typren-ring)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-[var(--typren-muted-fg)]" />
    </div>
  );
}

export { Select };
