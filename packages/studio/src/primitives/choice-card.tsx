import type { ReactNode } from "react";
import { cn } from "./cn";

/** One option of a radio group, as a card: a native radio, so arrows move
 *  between the cards sharing `name` and the form's own keys still work. The
 *  checked card takes the selection fill; its stroke stays the subtle one. */
export function ChoiceCard({
  name,
  checked,
  onSelect,
  children,
  className,
}: Readonly<{
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[var(--typren-radius-control)] px-4 py-3 ring-1 ring-[var(--typren-stroke-card)] transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--typren-ring)] motion-reduce:transition-none",
        checked ? "typren-selected bg-[var(--typren-fill-subtle-selected)]" : "typren-grain hover:bg-[var(--typren-fill-subtle-hover)]",
        className
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}
