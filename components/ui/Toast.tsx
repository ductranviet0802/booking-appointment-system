"use client";

import { cn } from "@/lib/cn";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ToastTone = "success" | "error";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const pushToast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);

    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        data-testid="toast-container"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      >
        {items.map((item) => (
          <div
            key={item.id}
            data-testid={`toast-item-${item.tone}`}
            className={cn(
              "animate-fade-up pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium text-white shadow-[0_16px_32px_-20px_rgba(15,23,42,0.85)] backdrop-blur",
              item.tone === "success"
                ? "border-emerald-400/40 bg-gradient-to-r from-emerald-500 to-sky-600"
                : "border-rose-400/40 bg-gradient-to-r from-rose-500 to-rose-600",
            )}
          >
            <span data-testid={`toast-icon-${item.tone}`} aria-hidden className="text-base leading-none">
              {item.tone === "success" ? "✓" : "!"}
            </span>
            <span data-testid={`toast-message-${item.tone}`}>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);

  if (!value) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return value;
}
