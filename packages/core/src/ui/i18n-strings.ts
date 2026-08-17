import type { Messages } from "../i18n";
import { defaultMessages } from "./messages";

/**
 * Vanilla (non-React) counterpart to @typren/editor's `useT`: same
 * key→host-override→English-default→literal-key fallback + `{var}`
 * interpolation, without a context provider. A non-React consumer calls
 * `createT(messages)` itself; `messages` is passed as a plain value, no
 * shared provider involved.
 */
export function createT(messages?: Partial<Messages>) {
  const merged = { ...defaultMessages, ...messages } as Messages;
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = merged[key] ?? defaultMessages[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
