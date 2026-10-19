"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { SlotCalendar } from "@/components/SlotCalendar";
import { SlotPicker } from "@/components/SlotPicker";
import { Select } from "@/components/ui/Select";
import { apiGet, apiPost, clearApiCache, ClientApiError } from "@/lib/client-api";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/hooks/useAuth";

type Doctor = { id: string; name: string; specialty: { name: string }; fee: number; hospital: { name: string } };
type DoctorsResponse = { doctors: Doctor[] };
type Slot = { id: string; date: string; start_time: string; end_time: string; is_booked: boolean };
type SlotsResponse = { slots: Slot[] };
type BookingResponse = { booking: { id: string } };

const ERROR_MESSAGES: Record<string, string> = {
  SLOT_ALREADY_BOOKED: "Khung giờ này vừa được người khác đặt. Vui lòng chọn slot khác.",
  DAILY_LIMIT_EXCEEDED: "Bạn đã đạt giới hạn 3 lịch hẹn trong ngày.",
  BOOKING_WINDOW_EXCEEDED: "Bạn chỉ có thể đặt lịch tối đa 30 ngày kể từ hôm nay.",
  BOOKING_TOO_LATE_TO_CANCEL: "Không thể thao tác do đã quá sát giờ hẹn.",
  UNAUTHORIZED: "Bạn cần đăng nhập để tiếp tục.",
};

export default function NewBookingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pushToast } = useToast();
  const { refresh } = useAuth();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [selectedDoctorId, setSelectedDoctorId] = useState(searchParams.get("doctor_id") ?? "");
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    apiGet<DoctorsResponse>("/api/doctors?limit=50")
      .then((data) => setDoctors(data.doctors))
      .catch(() => setDoctors([]));
  }, []);

  useEffect(() => {
    if (!selectedDoctorId) {
      setSlots([]);
      return;
    }

    setLoadingSlots(true);
    setSelectedSlotId("");

    apiGet<SlotsResponse>(`/api/doctors/${selectedDoctorId}/slots?date=${selectedDate}`)
      .then((data) => setSlots(data.slots))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDoctorId, selectedDate]);

  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => doctor.id === selectedDoctorId) ?? null,
    [doctors, selectedDoctorId],
  );

  const selectedSlot = useMemo(
    () => slots.find((slot) => slot.id === selectedSlotId) ?? null,
    [slots, selectedSlotId],
  );

  const onSubmit = async () => {
    if (!selectedDoctorId || !selectedSlotId) {
      setError("Vui lòng chọn bác sĩ và khung giờ.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const data = await apiPost<BookingResponse>("/api/bookings", {
        slot_id: selectedSlotId,
        notes,
      });

      clearApiCache("/api/bookings");
      clearApiCache("/api/doctors/");
      clearApiCache("/api/auth/me");
      await refresh();
      pushToast("Đặt lịch thành công");
      router.push(`/bookings/${data.booking.id}/success`);
    } catch (submitError) {
      if (submitError instanceof ClientApiError) {
        const mapped = ERROR_MESSAGES[submitError.code] ?? submitError.message;
        setError(mapped);
        pushToast(mapped, "error");
      } else {
        setError("Đặt lịch thất bại. Vui lòng thử lại.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="booking-form-layout space-y-5" data-testid="booking-new-page">
      <h1 className="animate-fade-up text-3xl font-black text-zinc-900" data-testid="booking-new-title">
        Đặt lịch khám
      </h1>

      <Card className="booking-form-card animate-fade-up space-y-4" style={{ animationDelay: "50ms" }} data-testid="booking-new-form-card">
        <div data-testid="booking-new-doctor-field">
          <label id="booking-new-doctor-label" className="mb-1.5 block text-sm font-semibold text-zinc-800" data-testid="booking-new-doctor-label">
            Chọn bác sĩ
          </label>
          <Select
            triggerTestId="booking-new-doctor-select"
            labelId="booking-new-doctor-label"
            value={selectedDoctorId}
            onValueChange={setSelectedDoctorId}
            placeholder="-- Chọn bác sĩ --"
            options={[{ value: "", label: "-- Chọn bác sĩ --" }, ...doctors.map((doctor) => ({ value: doctor.id, label: `${doctor.name} - ${doctor.specialty.name}`, "data-testid": `booking-new-doctor-option-${doctor.id}` }))]}
          />
        </div>

        <div className="space-y-2" data-testid="booking-new-date-field">
          <label className="block text-sm font-semibold text-zinc-800" data-testid="booking-new-date-label">
            Chọn ngày khám
          </label>
          <SlotCalendar selectedDate={selectedDate} onSelect={setSelectedDate} />
        </div>

        <div className="space-y-2" data-testid="booking-new-slot-field">
          <label className="block text-sm font-semibold text-zinc-800" data-testid="booking-new-slot-label">
            Chọn khung giờ
          </label>
          {loadingSlots ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="booking-new-slot-loading">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-11" data-testid={`booking-new-slot-skeleton-${index + 1}`} />
              ))}
            </div>
          ) : null}
          {!loadingSlots && slots.length === 0 ? (
            <p className="text-sm text-zinc-600" data-testid="booking-new-slot-empty">
              Không có slot trống cho ngày đã chọn.
            </p>
          ) : (
            <SlotPicker slots={slots} selectedSlot={selectedSlotId} onSelect={setSelectedSlotId} />
          )}
        </div>

        <div data-testid="booking-new-notes-field">
          <label className="mb-1 block text-sm font-semibold text-zinc-800" data-testid="booking-new-notes-label">
            Ghi chú bệnh nhân
          </label>
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Triệu chứng, lưu ý..."
            data-testid="booking-new-notes-input"
          />
        </div>
      </Card>

      <Card
        className="booking-confirmation-card animate-fade-up space-y-2"
        style={{ animationDelay: "100ms" }}
        data-testid="booking-new-confirmation-card"
      >
        <h2 className="text-lg font-bold" data-testid="booking-new-confirmation-title">
          Xác nhận thông tin
        </h2>
        <p className="text-sm text-zinc-600" data-testid="booking-new-confirmation-doctor">
          Bác sĩ: {selectedDoctor?.name ?? "--"}
        </p>
        <p className="text-sm text-zinc-600" data-testid="booking-new-confirmation-hospital">
          Bệnh viện: {selectedDoctor?.hospital.name ?? "--"}
        </p>
        <p className="text-sm text-zinc-600" data-testid="booking-new-confirmation-date">
          Ngày: {selectedDate}
        </p>
        <p className="text-sm text-zinc-600" data-testid="booking-new-confirmation-time">
          Giờ: {selectedSlot ? `${selectedSlot.start_time} - ${selectedSlot.end_time}` : "--"}
        </p>
        <p className="text-sm text-zinc-600" data-testid="booking-new-confirmation-fee">
          Phí khám: {selectedDoctor ? `${selectedDoctor.fee.toLocaleString("vi-VN")}đ` : "--"}
        </p>

        {error ? (
          <p className="text-sm text-rose-600" data-testid="booking-new-error">
            {error}
          </p>
        ) : null}

        <Button loading={submitting} onClick={onSubmit} data-testid="booking-new-submit-button">
          Xác nhận đặt lịch
        </Button>
      </Card>
    </div>
  );
}
