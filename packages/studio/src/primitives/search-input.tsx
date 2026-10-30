import { useRef, type ChangeEvent, type ComponentProps, type KeyboardEvent, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { cn } from "./cn";
import { Input } from "./input";

type OnChange = ((e: ChangeEvent<HTMLInputElement>) => void) | undefined;

/** Empties a controlled field through its own `onChange`, as typing would,
 *  and leaves focus in it. */
function clear(el: HTMLInputElement | null, onChange: OnChange) {
  if (!el) return;
  el.value = "";
  onChange?.({ target: el, currentTarget: el } as ChangeEvent<HTMLInputElement>);
  el.focus();
}

/** Escape in a search field with text clears it and goes no further, so a
 *  sheet or list around it closes only on a second Escape. True if it did. */
export function clearOnEscape(e: KeyboardEvent<HTMLInputElement>, onChange: OnChange) {
  if (e.key !== "Escape" || !e.currentTarget.value) return false;
  e.preventDefault();
  e.stopPropagation();
  clear(e.currentTarget, onChange);
  return true;
}

/** The clear button at a search field's trailing edge. Pressing it never
 *  takes focus from the field. */
export function ClearSearch({ input, onChange }: Readonly<{ input: RefObject<HTMLInputElement | null>; onChange: OnChange }>) {
  return (
    <button
      type="button"
      aria-label="Clear search"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        clear(input.current, onChange);
      }}
      className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[var(--typren-radius-control)] text-[var(--typren-muted-fg)] outline-none hover:bg-[var(--typren-fill-subtle-hover)] hover:text-[var(--typren-fg)] focus-visible:ring-2 focus-visible:ring-[var(--typren-ring)]"
    >
      <X className="size-4" aria-hidden />
    </button>
  );
}

/** An `Input` with the search glyph inside its leading edge and, while it
 *  holds text, a clear button at its trailing edge. `className` sizes the
 *  wrapper (e.g. `flex-1`); every other prop goes to the input, which must be
 *  controlled (`value`). */
export function SearchInput({ className, onKeyDown, ...props }: ComponentProps<typeof Input>) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--typren-muted-fg)]"
      />
      <Input
        ref={ref}
        {...props}
        onKeyDown={(e) => clearOnEscape(e, props.onChange) || onKeyDown?.(e)}
        className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {!!props.value && <ClearSearch input={ref} onChange={props.onChange} />}
    </div>
  );
}
