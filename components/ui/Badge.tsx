import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

export function Badge({
  children,
  tone = "default",
  className,
  "data-testid": dataTestId = "ui-badge",
  ...props
}: {
  children: ReactNode;
  tone?: "default" | "success" | "danger";
  "data-testid"?: string;
} & HTMLAttributes<HTMLSpanElement>) {

  return (
    <span
      data-testid={dataTestId}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold tracking-tight",
        tone === "default" && "border-zinc-200 bg-zinc-50 text-zinc-700",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "danger" && "border-rose-200 bg-rose-50 text-rose-700",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
