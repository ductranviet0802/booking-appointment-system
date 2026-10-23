"use client";

// _common event 17: a rate-limited request shows the red toast PE092, an offline / failed connection PE093;
// the screen and its input stay as they are. Returns null when the request did not reach the server.
import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";

export function useApiFetch() {
  const { toast } = useToast();
  return useCallback(
    async (url: string, init?: RequestInit): Promise<Response | null> => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        toast("PE093");
        return null;
      }
      try {
        const res = await fetch(url, init);
        if (res.status === 429) toast("PE092");
        // maintenance began meanwhile (event 14): the reload shows ER-04 in place of the screen
        if (res.status === 503 && (await res.clone().json().catch(() => ({}))).code === "PI092") window.location.reload();
        return res;
      } catch {
        toast("PE093");
        return null;
      }
    },
    [toast],
  );
}

/**
 * Staff screens: an API answer that leaves the screen (401 → ER-05, 403 → ER-03 SE091, SE090 or 5xx → ER-02) opens that
 * error screen and returns true; any other answer (field errors, SE0xx banners) stays with the caller.
 */
export async function openStaffErrorScreen(res: Response): Promise<boolean> {
  const code = res.status >= 400 ? ((await res.clone().json().catch(() => ({}))) as { code?: string }).code : undefined;
  const kind = res.status === 401 ? "expired" : res.status === 403 ? "forbidden" : res.status >= 500 || code === "SE090" ? "error" : null;
  if (kind) window.location.assign(`/staff/error/${kind}`);
  return kind !== null;
}

export function postJson(url: string, body: unknown): [string, RequestInit] {
  return [url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }];
}
