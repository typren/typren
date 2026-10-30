import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** Vendored shadcn `Empty`: the icon + title layout shared by empty states,
 *  drop targets and "not available" panes. Centred and fluid, so it works in
 *  a small panel as well as stretched over a whole one (`absolute inset-0`). */
function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn("flex min-w-0 flex-1 flex-col items-center justify-center gap-5 p-6 text-center text-balance", className)}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-1.5", className)} {...props} />;
}

/** `icon` seats the glyph in a soft tile; `default` leaves it bare. */
function EmptyMedia({ className, variant = "default", ...props }: ComponentProps<"div"> & { variant?: "default" | "icon" }) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(
        "mb-2 flex shrink-0 items-center justify-center text-[var(--typren-text-secondary)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "icon" &&
          "size-10 rounded-[var(--typren-radius-control)] bg-[var(--typren-fill-control)] ring-1 ring-[var(--typren-stroke-control)] [&_svg:not([class*='size-'])]:size-5",
        className
      )}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-title" className={cn("text-sm font-medium text-[var(--typren-text-primary)]", className)} {...props} />;
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("text-xs/relaxed text-[var(--typren-text-secondary)]", className)} {...props} />;
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-content" className={cn("flex max-w-sm flex-wrap items-center justify-center gap-2", className)} {...props} />;
}

/** The studio's empty, error and "not here" state: an icon in its tile, a
 *  title, a description and actions below. One padding everywhere; it centres
 *  itself in whatever pane it fills. The icon is required so no state reads
 *  as a bare line of text. */
function EmptyState({
  icon,
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { icon: ReactNode; title: ReactNode; description?: ReactNode }) {
  return (
    <Empty className={cn("py-8", className)} {...props}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}

export { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent, EmptyState };
