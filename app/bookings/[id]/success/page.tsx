"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { apiGet } from "@/lib/client-api";

type BookingDetail = {
  id: string;
  status: string;
  slot: {
    date: string;
    start_time: string;
    end_time: string;
  };
  doctor: {
    name: string;
    specialty: string;
    hospital: string;
    fee: number;
  };
};

export default function BookingSuccessPage() {
  const params = useParams<{ id: string }>();
  const bookingId = params?.id ?? "";
  const [booking, setBooking] = useState<BookingDetail | null>(null);

  useEffect(() => {
    if (!bookingId) {
      setBooking(null);
      return;
    }

    apiGet<{ booking: BookingDetail }>(`/api/bookings/${bookingId}`)
      .then((data) => setBooking(data.booking))
      .catch(() => setBooking(null));
  }, [bookingId]);

  return (
    <div className="mx-auto max-w-xl" data-testid="booking-success-page">
      <Card className="animate-fade-up space-y-3" data-testid="booking-success-card">
        <h1 className="text-2xl font-black text-emerald-700" data-testid="booking-success-title">
          Đặt lịch thành công
        </h1>

        {booking ? (
          <>
            <p className="text-zinc-700" data-testid="booking-success-id">
              Mã lịch hẹn: {booking.id}
            </p>
            <p className="text-zinc-700" data-testid="booking-success-doctor">
              Bác sĩ: {booking.doctor.name}
            </p>
            <p className="text-zinc-700" data-testid="booking-success-specialty">
              Chuyên khoa: {booking.doctor.specialty}
            </p>
            <p className="text-zinc-700" data-testid="booking-success-hospital">
              Bệnh viện: {booking.doctor.hospital}
            </p>
            <p className="text-zinc-700" data-testid="booking-success-slot">
              Thời gian: {booking.slot.date} ({booking.slot.start_time} - {booking.slot.end_time})
            </p>
            <p className="text-zinc-700" data-testid="booking-success-fee">
              Phí khám: {booking.doctor.fee.toLocaleString("vi-VN")}đ
            </p>
          </>
        ) : (
          <p className="text-zinc-600" data-testid="booking-success-empty">
            Không tải được chi tiết lịch hẹn.
          </p>
        )}

        <Link
          href="/bookings/me"
          className="inline-flex min-h-11 items-center rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:brightness-105"
          data-testid="booking-success-my-bookings-link"
        >
          Đi tới lịch của tôi
        </Link>
      </Card>
    </div>
  );
}
