"use client";

// P12 event 14 / P13 event 9: a CF-01 link (menu, logo) pressed while a draft is open asks PW005 first. The header's
// ログアウト is a button and is not caught (P13 event 9: it discards the draft without PW005, by revoking the session);
// the language switch is not a link either (_common event 2, the draft stays).
import { useEffect } from "react";

export function useLeaveGuard(onLeave: (href: string) => void) {
  useEffect(() => {
    const catchLink = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("header.hd a[href], #cf01-drawer a[href]");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      onLeave(a.getAttribute("href") ?? "/");
    };
    document.addEventListener("click", catchLink, true);
    return () => document.removeEventListener("click", catchLink, true);
  }, [onLeave]);
}
