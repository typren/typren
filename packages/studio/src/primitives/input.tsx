import type { ComponentProps } from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "./cn";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--typren-control-h)] w-full min-w-0 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] shadow-(--typren-elevation-input) px-3.5 py-1 text-[15px] text-[var(--typren-fg)] transition-colors duration-150 motion-reduce:transition-none outline-none hover:bg-[var(--typren-fill-control-hover)] placeholder:text-[var(--typren-muted-fg)] focus-visible:bg-[var(--typren-fill-control-input)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };
