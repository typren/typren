import { createContext, useContext } from "react";

/** The Frame's portal target. The studio's `.dark` class sits on the Frame
 *  root, not `<html>`, so portalled popups must mount inside it to inherit the
 *  theme. Outside a Frame (or before its first render) it is null, and the consumers fall back to Base UI's `document.body` default. */
export const PortalContext = createContext<HTMLElement | null>(null);

export const usePortal = () => useContext(PortalContext);
