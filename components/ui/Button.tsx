import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";

type Variant = "primary" | "secondary" | "danger" | "danger-fill";
const CLASS: Record<Variant, string> = { primary: "bp", secondary: "bs", danger: "bd", "danger-fill": "bdf" };

/** Pattern 「読み込み中」: while `busy` the button shows a spinner and is disabled (_common §3.1 Loading) */
export function Button({
  variant = "primary",
  busy = false,
  busyLabel,
  full = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; busyLabel?: string; full?: boolean; children: ReactNode }) {
  const off = disabled || busy;
  return (
    <button
      type={type}
      className={`btn ${off ? "bdis" : CLASS[variant]} ${full ? "bw" : ""} ${className}`.trim()}
      disabled={off}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Icon name="spin" className="spin" />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
