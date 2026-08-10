"use client";

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "@/components/ui/Spinner";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  "data-testid"?: string;
};

export function Button({
  className,
  children,
  loading,
  variant = "primary",
  disabled,
  "data-testid": dataTestId,
  ...props
}: Props) {
  return (
    <button
      data-testid={dataTestId ?? "ui-button"}
      className={cn(
        "relative inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" &&
          "bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-[0_12px_24px_-14px_rgba(8,145,178,0.85)] hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0",
        variant === "secondary" &&
          "border border-zinc-200 bg-white text-zinc-800 shadow-[0_10px_20px_-18px_rgba(15,23,42,0.8)] hover:-translate-y-0.5 hover:border-teal-200 hover:bg-teal-50/40 active:translate-y-0",
        variant === "danger" &&
          "bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-[0_12px_24px_-14px_rgba(225,29,72,0.75)] hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0",
        variant === "ghost" && "bg-transparent text-zinc-700 hover:bg-zinc-100",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner data-testid={`${dataTestId ?? "ui-button"}-spinner`} className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}
