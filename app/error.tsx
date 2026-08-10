"use client";

import { Button } from "@/components/ui/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div
      className="mx-auto max-w-xl space-y-4 rounded-3xl border border-rose-200 bg-rose-50/90 p-6 text-center shadow-[0_14px_30px_-22px_rgba(225,29,72,0.45)]"
      data-testid="global-error-page"
    >
      <h2 className="text-xl font-bold text-rose-700" data-testid="global-error-title">
        Đã có lỗi xảy ra
      </h2>
      <p className="text-sm text-rose-700" data-testid="global-error-message">
        {error.message || "Không thể tải dữ liệu."}
      </p>
      <Button onClick={reset} data-testid="global-error-retry-button">
        Thử lại
      </Button>
    </div>
  );
}
