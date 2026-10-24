"use client";

// Reading 6: FLASH_COOKIE carries one 04 id to the next screen (60 s). Read once on every navigation and dropped at once;
// PI041 (P01 after withdrawal), PI002 (after the NT-06 link), PI061 / PE004 (e-mail change link) become a toast here.
// Ids a screen shows in place (P02 box 1-1: PI021, PI011; P06 item 16: PE005, item 21: PE052) are read by that page.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { hasMessage } from "@/lib/i18n";

export const FLASH = "flash"; // = FLASH_COOKIE of lib/auth/session.ts (not imported: server module)
export const INLINE_FLASH = new Set(["PI021", "PI011", "PE005", "PE052"]);

export function readFlash(cookie: string) {
  const m = new RegExp(`(?:^|; )${FLASH}=([^;]*)`).exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

/** reads the flash once and drops it; returns the id to toast (null: none, or shown in place by its page) */
export function consumeFlash(doc: { cookie: string }) {
  const id = readFlash(doc.cookie);
  if (!id) return null;
  doc.cookie = `${FLASH}=; Max-Age=0; Path=/`;
  return hasMessage(id) && !INLINE_FLASH.has(id) ? id : null;
}

export function FlashToast() {
  const { toast } = useToast();
  const pathname = usePathname();
  useEffect(() => {
    const id = consumeFlash(document);
    if (id) toast(id);
  }, [pathname, toast]);
  return null;
}
