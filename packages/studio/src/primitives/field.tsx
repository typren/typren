import { useId, type ReactNode } from "react";
import { cn } from "./cn";
import { Label } from "./label";

/** A labelled control: the label over `children` (the control with id
 *  `htmlFor`) and an optional note under it, id `${htmlFor}-note` for the
 *  control's `aria-describedby`. An `error` note is announced and red. */
export function Field({
  label,
  htmlFor,
  note,
  error,
  children,
}: Readonly<{ label: ReactNode; htmlFor: string; note?: ReactNode; error?: boolean; children: ReactNode }>) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {note && (
        <p
          id={`${htmlFor}-note`}
          role={error ? "alert" : undefined}
          className={cn("mt-1 text-xs", error ? "text-[var(--typren-destructive)]" : "text-[var(--typren-muted-fg)]")}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** A checkbox with its label to the right, and an optional note under the
 *  label that describes it. `indeterminate` shows the mixed state of a
 *  select-all over a partly selected list. */
export function CheckboxRow({
  label,
  note,
  checked,
  indeterminate = false,
  disabled,
  onChange,
}: Readonly<{
  label: ReactNode;
  note?: ReactNode;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}>) {
  const id = useId();
  return (
    <label className={cn("flex gap-2 text-sm text-[var(--typren-fg)]", note ? "items-start" : "items-center")}>
      <input
        type="checkbox"
        className={cn("size-4 shrink-0 accent-[var(--typren-primary)]", note && "mt-0.5")}
        checked={checked}
        // A DOM property with no attribute, so it is set on the node.
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        disabled={disabled}
        aria-describedby={note ? id : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      {note ? (
        <span className="min-w-0">
          {label}
          <span id={id} className="block text-xs text-[var(--typren-muted-fg)]">
            {note}
          </span>
        </span>
      ) : (
        label
      )}
    </label>
  );
}
