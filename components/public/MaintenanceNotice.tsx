"use client";
// spec-screen: P01
// Item 1 and 1-1 (event 7): on mobile one truncated line that 詳しく expands in place and a second press collapses (Q14 b); desktop shows the full line.
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export function MaintenanceNotice({ text, lang }: { text: string; lang: Lang }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start gap-2" data-testid="p01-maintenance">
      <Icon name="tool" />
      <p className={`m-0 min-w-0 flex-1 md:whitespace-normal ${open ? "" : "truncate"}`} data-expanded={open}>
        <b className="hidden md:inline">{label("maintPrefix", lang)} </b>
        {text}
      </p>
      <button type="button" className="lnk-btn md:hidden" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label("detailMore", lang)}
      </button>
    </div>
  );
}
