"use client";

import type { ReactNode } from "react";
import { Frame, type RailBack } from "./frame";
import { ScrollArea } from "./primitives/scroll-area";
import { EntryLevel, type RailEntry } from "./site-rail";
import { Panel } from "./typren-studio";
import { useStoredChoice } from "./use-stored-choice";

export type StudioShellEntry = RailEntry & { group?: string };

/**
 * The studio's shell for a host level with no site, such as a cloud
 * account's Sites, Domains and Billing: the same top bar, rail and main
 * panel as `TyprenStudio`, with the host's entries as the level-0 rail and
 * the host's screen for the active one scrolling inside the panel. Entries
 * group by `group` in order of first appearance; ungrouped ones lead,
 * unlabelled.
 */
export function StudioShell({
  title,
  entries,
  activeId,
  onNavigate,
  topBarSlot,
  back = null,
  children,
}: Readonly<{
  /** Heads the rail, where a site studio shows the site's name. */
  title?: string;
  entries: StudioShellEntry[];
  activeId?: string;
  onNavigate: (id: string) => void;
  topBarSlot?: ReactNode;
  /** A level above this one, shown in place of the Typren lockup. */
  back?: RailBack;
  children: ReactNode;
}>) {
  // The site studio's key, so the theme follows the viewer between levels.
  const [theme, setTheme] = useStoredChoice("typren-theme", "light", ["light", "dark"]);
  const groups = new Map<string, StudioShellEntry[]>([["", []]]);
  for (const e of entries) groups.set(e.group ?? "", [...(groups.get(e.group ?? "") ?? []), e]);
  return (
    <Frame
      back={back}
      title={entries.find((e) => e.id === activeId)?.label}
      level={0}
      screen={activeId}
      rail={
        <EntryLevel
          title={title}
          groups={[...groups].filter(([, items]) => items.length).map(([id, items]) => ({ id, label: id, items }))}
          activeId={activeId}
          onOpen={onNavigate}
        />
      }
      onDevice={() => {}}
      topBarSlot={topBarSlot}
      dark={theme === "dark"}
      onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {/* Host screens scroll in the studio's own scrollbar, never a native one. */}
      <Panel>
        <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
      </Panel>
    </Frame>
  );
}
