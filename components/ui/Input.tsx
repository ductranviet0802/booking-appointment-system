"use client";

import { cn } from "@/lib/cn";
import type { InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  "data-testid"?: string;
};

export function Input({ className, error, "data-testid": dataTestId = "ui-input", ...props }: InputProps) {
  return (
    <div data-testid={`${dataTestId}-wrapper`} className="space-y-1">
      <input
        data-testid={dataTestId}
        className={cn(
          "min-h-11 w-full rounded-xl border border-sky-100 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none ring-sky-500 transition duration-200 placeholder:text-zinc-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-200",
          error ? "border-rose-400 ring-rose-300 focus:border-rose-500 focus:ring-rose-200" : "",
          className,
        )}
        {...props}
      />
      {error ? (
        <p data-testid={`${dataTestId}-error`} className="text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
