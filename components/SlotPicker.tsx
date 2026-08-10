"use client";

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  is_booked: boolean;
};

export function SlotPicker({
  slots,
  selectedSlot,
  onSelect,
}: {
  slots: Slot[];
  selectedSlot?: string;
  onSelect: (slotId: string) => void;
}) {
  const groups = {
    morning: slots.filter((slot) => Number(slot.start_time.slice(0, 2)) < 12),
    afternoon: slots.filter((slot) => Number(slot.start_time.slice(0, 2)) >= 12),
  };

  return (
    <div data-testid="booking-slot-picker" className="space-y-4">
      {["morning", "afternoon"].map((bucket) => {
        const data = groups[bucket as keyof typeof groups];
        const title = bucket === "morning" ? "Buổi sáng" : "Buổi chiều";

        return (
          <div key={bucket} data-testid={`booking-slot-bucket-${bucket}`} className="space-y-2">
            <h4 data-testid={`booking-slot-bucket-title-${bucket}`} className="text-sm font-semibold text-zinc-700">
              {title}
            </h4>
            <div data-testid={`booking-slot-grid-${bucket}`} className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {data.map((slot) => {
                const active = selectedSlot === slot.id;

                return (
                  <button
                    key={slot.id}
                    data-testid={`booking-slot-item-${slot.id}`}
                    type="button"
                    disabled={slot.is_booked}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-medium transition duration-200 ${
                      slot.is_booked
                        ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                        : ""
                    } ${
                      active
                        ? "border-teal-500 bg-teal-50 text-teal-700 shadow-[0_10px_20px_-18px_rgba(20,184,166,0.9)]"
                        : "border-zinc-300 bg-white text-zinc-700 hover:-translate-y-0.5 hover:border-teal-300 hover:bg-teal-50/40"
                    }`}
                    onClick={() => onSelect(slot.id)}
                  >
                    {slot.start_time} - {slot.end_time}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
