"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/client-api";

type BookingItem = {
  id: string;
  status: "CONFIRMED" | "CANCELED";
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

type BookingsResponse = {
  bookings: BookingItem[];
};

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"upcoming" | "past" | "canceled">("upcoming");

  useEffect(() => {
    apiGet<BookingsResponse>("/api/bookings/me")
      .then((data) => setBookings(data.bookings))
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const currentTimestamp = Date.now();

    return bookings.filter((booking) => {
      const appointmentStart = Date.parse(`${booking.slot.date}T${booking.slot.start_time}:00.000Z`);
      const isPast = appointmentStart < currentTimestamp;

      if (tab === "canceled") {
        return booking.status === "CANCELED";
      }

      if (tab === "past") {
        return booking.status === "CONFIRMED" && isPast;
      }

      return booking.status === "CONFIRMED" && !isPast;
    });
  }, [bookings, tab]);

  return (
    <div className="space-y-5" data-testid="my-bookings-page">
      <h1 className="animate-fade-up text-3xl font-black text-zinc-900" data-testid="my-bookings-title">
        Lịch hẹn của tôi
      </h1>

      <div className="animate-fade-up flex flex-wrap gap-2" style={{ animationDelay: "50ms" }} data-testid="my-bookings-tabs">
        <Button
          variant={tab === "upcoming" ? "primary" : "secondary"}
          onClick={() => setTab("upcoming")}
          data-testid="my-bookings-tab-upcoming"
        >
          Sắp tới
        </Button>
        <Button
          variant={tab === "past" ? "primary" : "secondary"}
          onClick={() => setTab("past")}
          data-testid="my-bookings-tab-past"
        >
          Đã khám
        </Button>
        <Button
          variant={tab === "canceled" ? "primary" : "secondary"}
          onClick={() => setTab("canceled")}
          data-testid="my-bookings-tab-canceled"
        >
          Đã hủy
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3" data-testid="my-bookings-loading">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28" data-testid={`my-bookings-skeleton-${index + 1}`} />
          ))}
        </div>
      ) : null}

      {!loading && filtered.length === 0 ? (
        <div
          className="surface-card rounded-3xl border border-zinc-200/80 p-8 text-center text-zinc-600"
          data-testid="my-bookings-empty-state"
        >
          Chưa có lịch hẹn trong mục này.
        </div>
      ) : null}

      <div className="space-y-3" data-testid="my-bookings-list">
        {filtered.map((booking, index) => (
          <Card
            key={booking.id}
            className="animate-fade-up flex flex-wrap items-center justify-between gap-4"
            style={{ animationDelay: `${index * 35}ms` }}
            data-testid={`my-bookings-item-${booking.id}`}
          >
            <div className="space-y-1" data-testid={`my-bookings-item-${booking.id}-info`}>
              <p className="text-lg font-bold text-zinc-900" data-testid={`my-bookings-item-${booking.id}-doctor`}>
                {booking.doctor.name}
              </p>
              <p className="text-sm text-zinc-600" data-testid={`my-bookings-item-${booking.id}-specialty`}>
                {booking.doctor.specialty}
              </p>
              <p className="text-sm text-zinc-600" data-testid={`my-bookings-item-${booking.id}-hospital`}>
                {booking.doctor.hospital}
              </p>
              <p className="text-sm text-zinc-500" data-testid={`my-bookings-item-${booking.id}-slot`}>
                {booking.slot.date} | {booking.slot.start_time} - {booking.slot.end_time}
              </p>
            </div>

            <div className="flex items-center gap-2" data-testid={`my-bookings-item-${booking.id}-actions`}>
              <Badge
                tone={booking.status === "CANCELED" ? "danger" : "success"}
                data-testid={`my-bookings-item-${booking.id}-status`}
              >
                {booking.status}
              </Badge>
              {booking.status === "CONFIRMED" && tab === "upcoming" ? (
                <Link href={`/bookings/${booking.id}/cancel`} prefetch={false} data-testid={`my-bookings-item-${booking.id}-cancel-link`}>
                  <Button variant="danger" data-testid={`my-bookings-item-${booking.id}-cancel-button`}>
                    Hủy lịch
                  </Button>
                </Link>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
