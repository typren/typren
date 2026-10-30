import { useCallback, useSyncExternalStore } from "react";

/** Whether `query` matches now, re-rendering when it starts or stops; false
 *  on the server and where `matchMedia` is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (change: () => void) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.("change", change);
      return () => list?.removeEventListener?.("change", change);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false, () => false);
}

/** Below the `md` breakpoint (48rem), where the studio lays out for a phone. */
export const PHONE = "(max-width: 47.99rem)";
