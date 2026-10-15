"use client";

import { addDays, format } from "date-fns";
import { vi } from "date-fns/locale";

export function SlotCalendar({
  selectedDate,
  onSelect,
}: {
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const today = new Date();
  const dates = Array.from({ length: 31 }, (_, index) => addDays(today, index));

  return (
    <div data-testid="booking-slot-calendar" className="grid grid-cols-2 gap-2 md:grid-cols-7">
      {dates.map((date) => {
        const value = format(date, "yyyy-MM-dd");
        const active = value === selectedDate;

        return (
          <button
            key={value}
            data-testid={`booking-calendar-date-${value}`}
            type="button"
            className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition duration-200 ${
              active
                ? "border-sky-500 bg-sky-50 text-sky-700 shadow-[0_10px_20px_-18px_rgba(0,148,255,0.9)]"
                : "border-sky-100 bg-white text-zinc-700 hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50/40"
            }`}
            onClick={() => onSelect(value)}
          >
            <div data-testid={`booking-calendar-date-label-${value}`} className="font-semibold">
              {format(date, "dd/MM", { locale: vi })}
            </div>
            <div data-testid={`booking-calendar-weekday-${value}`} className="text-xs text-zinc-500">
              {format(date, "EEEE", { locale: vi })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
