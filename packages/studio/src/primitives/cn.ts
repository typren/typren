import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Open and close motion for Base UI popups: fade and scale from the anchor. */
export const popupMotion =
  "origin-(--transform-origin) transition-[opacity,transform] duration-100 ease-in data-[open]:duration-150 data-[open]:ease-[cubic-bezier(0.2,0,0,1)] data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0 motion-reduce:transition-none";

/** shadcn class merge helper (vendored so the package is self-contained). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
