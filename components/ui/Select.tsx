"use client";

import * as SelectPrimitive from "@radix-ui/react-select";

const EMPTY_VALUE = "__booking_select_empty__";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  "data-testid"?: string;
};

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  triggerTestId,
  labelId,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  triggerTestId: string;
  labelId: string;
}) {
  return (
    <SelectPrimitive.Root value={value || EMPTY_VALUE} onValueChange={(next) => onValueChange(next === EMPTY_VALUE ? "" : next)}>
      <SelectPrimitive.Trigger
        data-testid={triggerTestId}
        aria-labelledby={labelId}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-sky-100 bg-white px-3.5 py-2.5 text-left text-sm text-zinc-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <SelectPrimitive.Value placeholder={placeholder} className="min-w-0 truncate" />
        <SelectPrimitive.Icon aria-hidden className="shrink-0 text-sky-600">⌄</SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          align="start"
          collisionPadding={12}
          className="z-50 max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-sky-100 bg-white p-1.5 shadow-xl shadow-slate-900/10"
        >
          <SelectPrimitive.Viewport className="max-h-[min(320px,var(--radix-select-content-available-height))] p-0.5">
            {options.map((option) => {
              const itemValue = option.value || EMPTY_VALUE;
              return (
                <SelectPrimitive.Item
                  key={itemValue}
                  value={itemValue}
                  disabled={option.disabled}
                  data-testid={option["data-testid"]}
                  className="relative flex min-h-10 cursor-default select-none items-center rounded-lg py-2 pl-3 pr-9 text-sm leading-5 text-slate-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-sky-50 data-[highlighted]:text-sky-800"
                >
                  <SelectPrimitive.ItemText className="break-words">{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center text-sky-600">✓</SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
