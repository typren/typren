"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Messages } from "@typren/core";
import { defaultMessages } from "@typren/core/ui/messages";

const Ctx = createContext<{ messages: Messages }>({ messages: defaultMessages });

/** Provides editor-UI strings. Mount once around the editor (its layout/shell).
 *  `messages` are host overrides deep-merged onto the package's English
 *  defaults. Content locale and UI locale are independent — an English-speaking
 *  editor can edit `es` content. */
export function CmsIntlProvider({
  messages,
  children,
}: Readonly<{ messages?: Partial<Messages>; children: ReactNode }>) {
  // `messages` is Partial (may carry undefined values); the merged record still
  // has every default key, and useT falls back per-key, so cast is safe.
  const merged = { ...defaultMessages, ...messages } as Messages;
  return <Ctx.Provider value={{ messages: merged }}>{children}</Ctx.Provider>;
}

/** Translate a key with optional `{var}` interpolation. Falls back to the
 *  English default, then to the key itself (so a missing string is visible, not
 *  a crash). Works without a provider (defaults come from the context default). */
export function useT() {
  const { messages } = useContext(Ctx);
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = messages[key] ?? defaultMessages[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
