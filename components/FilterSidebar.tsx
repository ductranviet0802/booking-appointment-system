"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type Option = { id: string; name: string };

type Filters = {
  specialty_id?: string;
  city?: string;
  min_fee?: string;
  max_fee?: string;
  sort?: string;
};

export function FilterSidebar({
  specialties,
  value,
  onChange,
}: {
  specialties: Option[];
  value: Filters;
  onChange: (next: Filters) => void;
}) {
  const [localCity, setLocalCity] = useState(value.city ?? "");
  const [localMinFee, setLocalMinFee] = useState(value.min_fee ?? "");
  const [localMaxFee, setLocalMaxFee] = useState(value.max_fee ?? "");

  const latestLocalValues = useRef({
    city: value.city ?? "",
    min_fee: value.min_fee ?? "",
    max_fee: value.max_fee ?? "",
  });

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalCity(value.city ?? "");
    setLocalMinFee(value.min_fee ?? "");
    setLocalMaxFee(value.max_fee ?? "");

    latestLocalValues.current = {
      city: value.city ?? "",
      min_fee: value.min_fee ?? "",
      max_fee: value.max_fee ?? "",
    };

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
  }, [value.city, value.min_fee, value.max_fee]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const triggerDebouncedChange = () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      onChange({
        ...value,
        city: latestLocalValues.current.city || undefined,
        min_fee: latestLocalValues.current.min_fee || undefined,
        max_fee: latestLocalValues.current.max_fee || undefined,
      });
      debounceTimeoutRef.current = null;
    }, 2000);
  };

  const handleCityChange = (newCity: string) => {
    setLocalCity(newCity);
    latestLocalValues.current.city = newCity;
    triggerDebouncedChange();
  };

  const handleMinFeeChange = (newMinFee: string) => {
    setLocalMinFee(newMinFee);
    latestLocalValues.current.min_fee = newMinFee;
    triggerDebouncedChange();
  };

  const handleMaxFeeChange = (newMaxFee: string) => {
    setLocalMaxFee(newMaxFee);
    latestLocalValues.current.max_fee = newMaxFee;
    triggerDebouncedChange();
  };

  return (
    <aside
      data-testid="doctors-filter-sidebar"
      className="surface-card space-y-4 rounded-3xl border border-zinc-200/80 p-4"
    >
      <div data-testid="doctors-filter-specialty-group">
          <label
          data-testid="doctors-filter-specialty-label"
            id="doctors-filter-specialty-label"
          className="mb-1.5 block text-sm font-semibold text-zinc-800"
        >
          Chuyên khoa
        </label>
        <Select
          triggerTestId="doctors-filter-specialty-select"
          labelId="doctors-filter-specialty-label"
          value={value.specialty_id ?? ""}
          onValueChange={(next) => onChange({ ...value, specialty_id: next || undefined })}
          placeholder="Tất cả chuyên khoa"
          options={[{ value: "", label: "Tất cả chuyên khoa" }, ...specialties.map((item) => ({ value: item.id, label: item.name }))]}
        />
      </div>

      <div data-testid="doctors-filter-city-group">
        <label data-testid="doctors-filter-city-label" className="mb-1.5 block text-sm font-semibold text-zinc-800">
          Thành phố
        </label>
        <Input
          data-testid="doctors-filter-city-input"
          value={localCity}
          placeholder="Ví dụ: Hà Nội"
          onChange={(event) => handleCityChange(event.target.value)}
        />
      </div>

      <div data-testid="doctors-filter-fee-group" className="grid grid-cols-2 gap-2">
        <div data-testid="doctors-filter-min-fee-group">
          <label data-testid="doctors-filter-min-fee-label" className="mb-1.5 block text-sm font-semibold text-zinc-800">
            Phí từ
          </label>
          <Input
            data-testid="doctors-filter-min-fee-input"
            type="number"
            value={localMinFee}
            onChange={(event) => handleMinFeeChange(event.target.value)}
          />
        </div>
        <div data-testid="doctors-filter-max-fee-group">
          <label data-testid="doctors-filter-max-fee-label" className="mb-1.5 block text-sm font-semibold text-zinc-800">
            Phí đến
          </label>
          <Input
            data-testid="doctors-filter-max-fee-input"
            type="number"
            value={localMaxFee}
            onChange={(event) => handleMaxFeeChange(event.target.value)}
          />
        </div>
      </div>

      <div data-testid="doctors-filter-sort-group">
        <label id="doctors-filter-sort-label" data-testid="doctors-filter-sort-label" className="mb-1.5 block text-sm font-semibold text-zinc-800">
          Sắp xếp
        </label>
        <Select
          triggerTestId="doctors-filter-sort-select"
          labelId="doctors-filter-sort-label"
          value={value.sort ?? ""}
          onValueChange={(next) => onChange({ ...value, sort: next || undefined })}
          placeholder="Mặc định"
          options={[{ value: "", label: "Mặc định" }, { value: "rating", label: "Đánh giá cao" }, { value: "fee", label: "Phí thấp đến cao" }]}
        />
      </div>

      <Button
        data-testid="doctors-filter-reset-button"
        variant="secondary"
        className="w-full"
        onClick={() =>
          onChange({
            specialty_id: undefined,
            city: undefined,
            min_fee: undefined,
            max_fee: undefined,
            sort: undefined,
          })
        }
      >
        Xóa bộ lọc
      </Button>
    </aside>
  );
}
