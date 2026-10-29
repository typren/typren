import type { CSSProperties } from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "./cn";

/** Vendored shadcn base-nova ScrollArea on Base UI: thin themeable scrollbars
 *  that follow `--typren-*`, shown only while scrolling (or under the pointer,
 *  so they can still be grabbed). `scrollbars` picks the axes. */
function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportStyle,
  scrollbars = "vertical",
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string;
  viewportStyle?: CSSProperties;
  scrollbars?: "vertical" | "horizontal" | "both";
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        style={viewportStyle}
        className={cn(
          "size-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]",
          // Contain only the axes this area scrolls: a horizontal-only area
          // (a wide table) must hand vertical wheel input on to the page's
          // scroller, or the rows under the pointer can't be scrolled.
          { vertical: "overscroll-y-contain", horizontal: "overscroll-x-contain", both: "overscroll-contain" }[scrollbars],
          viewportClassName
        )}
      >
        {/* Content is what Base UI measures: without it the thumb keeps the
            size it had before async content (a list loading) grew the area. */}
        <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {scrollbars !== "horizontal" && <ScrollBar />}
      {scrollbars !== "vertical" && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ className, orientation = "vertical", ...props }: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        // Flush to the edge and full length, so a rounded container (the
        // studio's card clips its content to its radius) cuts the bar along
        // its own curve rather than the bar stopping short of it. The bar is
        // a 14px grab area around a 6px thumb that widens on hover.
        "group/bar z-20 flex touch-none opacity-0 transition-opacity duration-300 motion-reduce:transition-none select-none hover:opacity-100 data-scrolling:opacity-100 data-scrolling:duration-75 data-[orientation=horizontal]:h-3.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-3.5",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative rounded-full bg-[var(--typren-muted-fg)]/40 transition-[background-color,width,height] duration-150 group-hover/bar:bg-[var(--typren-muted-fg)]/70 motion-reduce:transition-none group-data-[orientation=vertical]/bar:ml-auto group-data-[orientation=vertical]/bar:w-1.5 group-data-[orientation=vertical]/bar:group-hover/bar:w-2.5 group-data-[orientation=horizontal]/bar:mt-auto group-data-[orientation=horizontal]/bar:h-1.5 group-data-[orientation=horizontal]/bar:group-hover/bar:h-2.5"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
