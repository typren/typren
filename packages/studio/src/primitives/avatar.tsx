import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "./cn";

/** A small circle showing `src`, or the initials of `name` while it loads or
 *  when there is no image. Decorative: the name is on the control around it. */
function Avatar({
  name,
  src,
  className,
}: Readonly<{ name: string; src?: string | null; className?: string }>) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "inline-flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-[var(--typren-fill-control)] text-xs font-medium text-[var(--typren-fg)]",
        className
      )}
    >
      {src && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback aria-hidden>{initials}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar };
