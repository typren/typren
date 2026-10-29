import { useLayoutEffect, useState } from "react";

/** A per-viewer choice kept in localStorage. Server and first client render
 *  both start at `fallback`, since reading storage during render would make
 *  the two disagree and break hydration; the stored value lands in a layout
 *  effect, before the first paint, so a stored layout choice never flashes.
 *  Storage can be missing or throw (private mode, some embeds): then the
 *  choice just isn't remembered. */
export function useStoredChoice<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(fallback);
  useLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      if (stored && allowed.includes(stored)) setValue(stored);
    } catch {
      // Unavailable storage: keep the fallback.
    }
    // Read once per key; `allowed` is a literal at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const choose = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Unavailable storage: the choice lasts this visit only.
    }
  };
  return [value, choose] as const;
}
