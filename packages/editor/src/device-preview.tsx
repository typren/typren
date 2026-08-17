"use client";

import type React from "react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Monitor, Moon, Smartphone, Sun, Tablet } from "lucide-react";
import { cn } from "./primitives/cn";
import { ScrollArea } from "./primitives/scroll-area";

type Device = "desktop" | "tablet" | "mobile";

const WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };
const DEVICES: { id: Device; icon: typeof Monitor; label: string }[] = [
  { id: "desktop", icon: Monitor, label: "Desktop" },
  { id: "tablet", icon: Tablet, label: "Tablet" },
  { id: "mobile", icon: Smartphone, label: "Mobile" },
];
const MIN_W = 320;

/** Center preview: device-size switcher + free drag-resize + independent
 *  light/dark toggle, over a live iframe in a shadcn-style scroll container. */
export function DevicePreview({
  src,
  reloadKey,
  iframeRef,
}: Readonly<{ src: string; reloadKey: number; iframeRef?: RefObject<HTMLIFrameElement | null> }>) {
  const [device, setDevice] = useState<Device>("desktop");
  const [custom, setCustom] = useState<number | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const areaRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const width = custom ?? WIDTHS[device];

  const pushTheme = () =>
    iframeRef?.current?.contentWindow?.postMessage(
      { __typren: true, type: "theme", theme },
      window.location.origin
    );
  // Re-assert theme whenever it changes or the preview reloads (fresh document).
  useEffect(pushTheme, [theme, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (d: Device) => {
    setDevice(d);
    setCustom(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const startW = width ?? areaRef.current?.clientWidth ?? 1024;
    drag.current = { startX: e.clientX, startW };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const max = areaRef.current?.clientWidth ?? 2000;
    // right-edge handle on a centered frame -> grows twice the pointer delta
    const next = drag.current.startW + (e.clientX - drag.current.startX) * 2;
    setCustom(Math.max(MIN_W, Math.min(next, max)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const framed = width != null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--typren-muted)]">
      <div className="flex items-center gap-1 border-b border-[var(--typren-border)] bg-[var(--typren-bg)] px-2 py-1.5">
        <div className="flex flex-1 items-center justify-center gap-1">
          {DEVICES.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={custom == null && device === id}
              onClick={() => pick(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                custom == null && device === id
                  ? "bg-[var(--typren-muted)] text-[var(--typren-fg)]"
                  : "text-[var(--typren-muted-fg)] hover:bg-[var(--typren-muted)] hover:text-[var(--typren-fg)]"
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
          <span className="ml-2 w-14 text-xs text-[var(--typren-muted-fg)]">
            {width ? `${Math.round(width)}px` : "full"}
          </span>
        </div>
        <button
          type="button"
          aria-label="Toggle preview theme"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-[var(--typren-muted-fg)] transition-colors hover:bg-[var(--typren-muted)] hover:text-[var(--typren-fg)]"
        >
          {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          {theme === "dark" ? "Dark" : "Light"}
        </button>
      </div>

      <ScrollArea ref={areaRef} className="flex min-h-0 flex-1 justify-center p-0 md:p-4">
        <div
          className={cn(
            "relative h-full bg-white",
            framed ? "shrink-0 overflow-hidden rounded-xl border border-[var(--typren-border)] shadow-lg" : "w-full"
          )}
          style={framed ? { width } : undefined}
        >
          <iframe
            ref={iframeRef}
            key={reloadKey}
            title="Live preview"
            src={src}
            onLoad={pushTheme}
            className="h-full w-full border-0 bg-white"
          />
          {framed && (
            <div
              role="separator"
              aria-label="Drag to resize preview"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute inset-y-0 -right-1.5 w-3 cursor-col-resize touch-none"
            >
              <div className="mx-auto h-full w-0.5 bg-[var(--typren-border)] opacity-0 transition-opacity hover:opacity-100" />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
