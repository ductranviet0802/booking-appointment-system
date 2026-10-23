"use client";

// spec-pattern: items 34, 34-1…34-4 (confirmation dialog for W messages). Modal; the negative button (left, tab first)
// closes and does nothing; the positive one runs the action of the opening screen and shows a spinner while it runs.
import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { STAFF } from "@/lib/i18n/labels";
import { Button } from "./Button";
import { useLang } from "./Toast";

export type ConfirmDialogProps = {
  open: boolean;
  /** per-screen title (34-1) */
  title: string;
  /** W message id of 04 (34-2) */
  messageId: string;
  params?: Record<string, string | number>;
  /** staff: positive button verb (取り消す, 無効化する); default はい */
  confirmLabel?: string;
  /** red filled verb button of a destructive action */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

/** Modal focus trap: Tab / Shift+Tab wrap inside the element that has this as onKeyDown (item 34, A05 ⑤) */
export function trapTab(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const f = e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
  if (!f.length) return;
  const edge = e.shiftKey ? f[0] : f[f.length - 1];
  const inside = e.currentTarget.contains(document.activeElement);
  if (!inside || document.activeElement === edge) {
    e.preventDefault();
    (e.shiftKey ? f[f.length - 1] : f[0]).focus();
  }
}

export function ConfirmDialog({ open, title, messageId, params, confirmLabel, destructive, onConfirm, onCancel }: ConfirmDialogProps) {
  const lang = useLang();
  const staff = messageId.startsWith("S");
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="scrim-fixed"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onCancel();
        trapTab(e);
      }}
    >
      <div className="dlg" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 id={titleId}>{title}</h3>
        <p className="mut" style={{ margin: 0 }}>{t(messageId, lang, params)}</p>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button ref={cancelRef} type="button" className="btn bs" onClick={onCancel} disabled={busy}>
            {staff ? STAFF.cancel : label("no", lang)}
          </button>
          <Button variant={destructive ? "danger-fill" : "primary"} busy={busy} onClick={confirm}>
            {confirmLabel ?? (staff ? STAFF.yes : label("yes", lang))}
          </Button>
        </div>
      </div>
    </div>
  );
}
