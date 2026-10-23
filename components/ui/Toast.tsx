"use client";

// spec-pattern: item 33 / 33-1 (toast). Top centre, role="status", takes no focus, closes after 4 s or by × (event 27;
// error toasts too, _common Q7). PE / SE ids render red with an alert icon (state ⑮).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { Lang, Params } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { Icon } from "./Icon";

export const TOAST_MS = 4000;

type ToastItem = { key: number; text: string; error: boolean };
type ToastOptions = { params?: Params; lang?: Lang };
type ToastApi = { toast: (id: string, options?: ToastOptions) => void };

const LangContext = createContext<Lang>("ja");
const ToastContext = createContext<ToastApi | null>(null);

/** UI language of the current request (set by the root layout) */
export function useLang() {
  return useContext(LangContext);
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast needs <ToastProvider>");
  return ctx;
}

export function ToastProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  const close = useCallback((key: number) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const toast = useCallback(
    (id: string, options: ToastOptions = {}) => {
      const key = ++seq.current;
      const text = t(id, options.lang ?? lang, options.params);
      setItems((prev) => [...prev, { key, text, error: /^[PS]E/.test(id) }]);
      timers.current.set(key, setTimeout(() => close(key), TOAST_MS));
    },
    [lang, close],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <LangContext.Provider value={lang}>
      <ToastContext.Provider value={api}>
        {children}
        <div className="toast-area">
          {items.map((item) => (
            <div key={item.key} role="status" className={`toast ${item.error ? "toast-err" : ""}`}>
              <Icon name={item.error ? "alert" : "check"} />
              <span>{item.text}</span>
              <button type="button" aria-label={label("close", lang)} onClick={() => close(item.key)}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </LangContext.Provider>
  );
}
