"use client";

import { createContext, useContext, useEffect } from "react";

/** Sends a message to the Frame's one polite live region. Outside a Frame it
 *  does nothing. */
export const AnnounceContext = createContext<(message: string) => void>(() => {});

/** Announces `message` whenever it changes to something non-empty, so a screen's
 *  save/publish/push status reaches screen readers without a live region of its own. */
export function useAnnounce(message: string) {
  const announce = useContext(AnnounceContext);
  useEffect(() => {
    if (message) announce(message);
  }, [message, announce]);
}
