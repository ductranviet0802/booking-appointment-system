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
        return res;
      } catch {
        toast("PE093");
        return null;
      }
    },
    [toast],
  );
}

export function postJson(url: string, body: unknown): [string, RequestInit] {
  return [url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }];
}
