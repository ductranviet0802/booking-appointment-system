"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { apiDelete, apiGet, clearApiCache, ClientApiError } from "@/lib/client-api";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/hooks/useAuth";

type BookingDetail = {
  id: string;
  status: string;
  doctor: { name: string; specialty: string; hospital: string };
  slot: { date: string; start_time: string; end_time: string };
};

export default function CancelBookingPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params?.id ?? "";
  const router = useRouter();
  const { pushToast } = useToast();
  const { refresh } = useAuth();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bookingId) {
      setBooking(null);
      return;
    }

    apiGet<{ booking: BookingDetail }>(`/api/bookings/${bookingId}`)
      .then((data) => setBooking(data.booking))
      .catch(() => setBooking(null));
  }, [bookingId]);

  const onCancel = async () => {
    if (!booking) return;

    setSubmitting(true);
    setError("");

    try {
      await apiDelete(`/api/bookings/${booking.id}`);
      clearApiCache("/api/bookings");
      clearApiCache("/api/doctors/");
      clearApiCache("/api/auth/me");
      await refresh();
      pushToast("Hủy lịch thành công");
      router.push("/bookings/me");
    } catch (cancelError) {
      if (cancelError instanceof ClientApiError) {
        setError(cancelError.message);
        pushToast(cancelError.message, "error");
      } else {
        setError("Không thể hủy lịch vào lúc này.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!booking) {
    return (
      <div
        className="surface-card rounded-3xl border border-zinc-200/80 p-8 text-center text-zinc-600"
        data-testid="booking-cancel-not-found"
      >
        Không tìm thấy lịch hẹn.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl" data-testid="booking-cancel-page">
      <Card className="animate-fade-up space-y-3" data-testid="booking-cancel-card">
        <h1 className="text-2xl font-black text-zinc-900" data-testid="booking-cancel-title">
          Xác nhận hủy lịch
        </h1>
        <p className="text-zinc-700" data-testid="booking-cancel-doctor">
          Bác sĩ: {booking.doctor.name}
        </p>
        <p className="text-zinc-700" data-testid="booking-cancel-hospital">
          Bệnh viện: {booking.doctor.hospital}
        </p>
        <p className="text-zinc-700" data-testid="booking-cancel-slot">
          Thời gian: {booking.slot.date} ({booking.slot.start_time} - {booking.slot.end_time})
        </p>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700" data-testid="booking-cancel-note">
          Lưu ý: bạn chỉ có thể hủy trước giờ hẹn ít nhất 1 giờ.
        </p>

        {error ? (
          <p className="text-sm text-rose-600" data-testid="booking-cancel-error">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2" data-testid="booking-cancel-actions">
          <Button variant="danger" loading={submitting} onClick={onCancel} data-testid="booking-cancel-confirm-button">
            Xác nhận hủy
          </Button>
          <Button
            variant="secondary"
            onClick={() => router.push("/bookings/me")}
            data-testid="booking-cancel-back-button"
          >
            Quay lại
          </Button>
        </div>
      </Card>
    </div>
  );
}
