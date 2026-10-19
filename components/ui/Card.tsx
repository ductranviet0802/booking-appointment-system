import { cn } from "@/lib/cn";
import type { HTMLAttributes, PropsWithChildren } from "react";

type CardProps = PropsWithChildren<
  HTMLAttributes<HTMLDivElement> & {
    "data-testid"?: string;
  }
>;

export function Card({ className, children, "data-testid": dataTestId = "ui-card", ...props }: CardProps) {

  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "surface-card rounded-3xl border border-zinc-200/80 p-5 transition duration-300 ease-out hover:border-sky-200/80 hover:shadow-[0_16px_34px_-22px_rgba(15,59,96,0.24)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
