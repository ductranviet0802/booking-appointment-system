import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

type SpinnerProps = HTMLAttributes<HTMLSpanElement> & {
  "data-testid"?: string;
};

export function Spinner({ className, "data-testid": dataTestId = "ui-spinner", ...props }: SpinnerProps) {
  return (
    <span
      data-testid={dataTestId}
      className={cn(
        "inline-block h-5 w-5 animate-spin rounded-full border-2 border-current/40 border-t-current border-r-transparent",
        className,
      )}
      {...props}
    />
  );
}
