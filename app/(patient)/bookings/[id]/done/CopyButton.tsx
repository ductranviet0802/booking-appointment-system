"use client";

// spec-screen: P14
// Item 3-1 (event 2, Q9): copies the 予約番号 as shown (ABCD-1234); the label reads 「コピーしました」 for 2 s; without a
// clipboard (non-secure context, in-app browser) the number is selected for a manual copy. Nothing goes to the server.
import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import { w2 } from "@/lib/i18n/labels-w2";

export function CopyButton({ value, targetId, lang, className }: { value: string; targetId: string; lang: Lang; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      const el = document.getElementById(targetId);
      if (el) window.getSelection()?.selectAllChildren(el);
    }
  }
  return (
    <button type="button" className={`btn btn-sm bs ${className ?? ""}`.trim()} onClick={copy} aria-live="polite" data-testid="p14-copy">
      <svg viewBox="0 0 24 24" className="ico" aria-hidden="true" focusable="false">
        <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </svg>
      {w2(done ? "copied" : "copy", lang)}
    </button>
  );
}
