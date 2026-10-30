"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./primitives/select";

/** The site's content locales and the one shown, for the top bar's switcher. */
export type LocaleSwitch = { value: string; locales: string[]; onChange: (locale: string) => void };

/** The top bar's locale switcher: which locale the preview, and the page
 *  editor's content, show. Labelled by locale code, at the top bar's height. */
export function LocaleSelect({ value, locales, onChange }: Readonly<LocaleSwitch>) {
  return (
    <Select value={value} onValueChange={(next) => next !== null && next !== value && onChange(next)}>
      <SelectTrigger aria-label="Preview locale" className="w-auto shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((l) => (
          <SelectItem key={l} value={l}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
