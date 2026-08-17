import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn class merge helper (vendored so the package is self-contained). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
