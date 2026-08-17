import type { ComponentProps } from "react";
import { cn } from "./cn";

/** shadcn-style scroll container — thin, rounded, themeable scrollbars via CSS
 *  (no primitive-lib dependency, so the package stays self-contained). */
function ScrollArea({ className, children, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        "overflow-auto [scrollbar-color:var(--typren-border)_transparent] [scrollbar-width:thin]",
        "[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2",
        "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--typren-border)]",
        "[&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb:hover]:bg-[var(--typren-muted-fg)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { ScrollArea };
