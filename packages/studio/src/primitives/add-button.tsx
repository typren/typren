import type { ComponentProps, ReactNode } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Plus } from "lucide-react";
import { Button } from "./button";
import { cn } from "./cn";
import { usePortal } from "./portal";
import { Select, SelectContent, SelectItem } from "./select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type AddButtonProps = Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  /** The accessible name, and the tooltip or visible text. */
  label: string;
  /** Shows `label` beside the glyph, for an add at the foot of a list. */
  labelled?: boolean;
  /** Replaces the plus, for an add that makes something specific (a folder). */
  icon?: ReactNode;
};

/** The studio's one "add" control: a ghost icon button with the label as
 *  its tooltip, or, `labelled`, a small outline button with plus and text.
 *  Pass it as a popup trigger's `render` to open a menu instead. */
export function AddButton({ label, labelled, icon = <Plus />, className, children, ...props }: AddButtonProps) {
  const portal = usePortal();
  // A trigger rendering this hands over its own (empty) `children`; the glyph wins.
  void children;
  if (labelled)
    return (
      // The name repeats the text: a menu trigger is a combobox, which takes no name from content.
      <Button variant="outline" size="sm" aria-label={label} className={cn("pl-2 pr-4", className)} {...props}>
        {icon}
        {label}
      </Button>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} className={className} {...props} />}>{icon}</TooltipTrigger>
      <TooltipContent container={portal ?? undefined}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** An `AddButton` that opens a list to pick what to add. */
export function AddMenu({
  label,
  labelled,
  options,
  onPick,
}: Readonly<{
  label: string;
  labelled?: boolean;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}>) {
  return (
    <Select value={null} onValueChange={(v: string | null) => v && onPick(v)}>
      <SelectPrimitive.Trigger render={<AddButton label={label} labelled={labelled} />} />
      <SelectContent className="w-auto">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
