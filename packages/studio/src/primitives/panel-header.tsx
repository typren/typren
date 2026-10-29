import type { ReactNode } from "react";

/** A rail level's heading row: the 22px title, with its actions (an
 *  `AddButton`) at the end. One height with or without actions, so titles
 *  line up from level to level. */
export function PanelHeader({ title, children }: Readonly<{ title: string; children?: ReactNode }>) {
  return (
    <div className="flex min-h-[var(--typren-control-h)] items-center justify-between gap-2 pb-4 pl-6 pr-3 pt-2 box-content">
      <span title={title} className="min-w-0 truncate text-[22px] font-semibold tracking-tight text-[var(--typren-fg)]">
        {title}
      </span>
      {children}
    </div>
  );
}
