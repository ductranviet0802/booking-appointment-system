import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  "data-testid"?: string;
};

export function Skeleton({ className, "data-testid": dataTestId = "ui-skeleton", ...props }: SkeletonProps) {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "skeleton-shimmer animate-soft-pulse rounded-xl border border-zinc-100 bg-gradient-to-r from-zinc-100 via-zinc-50 to-zinc-100",
        className,
      )}
      {...props}
    />
  );
}
