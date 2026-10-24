"use client";

// spec-pattern: shared date picker — A01 items 12-1 / 12-2, A02 date inputs, P11 date step (F4-02 month calendar with
// markers), S02 item 22. MonthGrid: the month is one Tab stop; arrow keys move the date (across months), Enter picks,
// the cursor is announced by aria-activedescendant. DateField: a 「YYYY/MM/DD」 text box plus a button that opens a
// MonthGrid; picking writes the text and returns focus to the box; Esc closes.
import { useEffect, useId, useRef, useState } from "react";
import { addDays, todayJst, weekdayOf } from "@/lib/datetime";
import type { Lang } from "@/lib/i18n";
import { firstWeekday, formatDate, formatMonthHeading } from "@/lib/i18n/format";
import { label } from "@/lib/i18n/labels";
import { Icon } from "./Icon";

const HEAD: Record<Lang, string[]> = {
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  vi: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"],
};
const pad = (n: number) => String(n).padStart(2, "0");

/** the dates of a month "YYYY-MM" as calendar rows: leading nulls up to the first weekday of the row */
export function monthCells(ym: string, first: number): Array<string | null> {
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (weekdayOf(`${ym}-01`) - first + 7) % 7;
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${pad(i + 1)}`)];
}

/** arrow key → days to move (MonthGrid), else null */
export const stepOf = (key: string) => ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[key] ?? null;

/** 「YYYY/MM/DD」 or 「YYYY-MM-DD」 (full-width digits allowed) → ISO date, else null */
export function parseDateText(text: string): string | null {
  const s = text.trim().replace(/[０-９／－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

export const isoToText = (iso: string) => iso.replace(/-/g, "/");
const monthOf = (iso: string) => iso.slice(0, 7);
const shiftMonth = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export type MonthGridProps = {
  /** "YYYY-MM" shown */
  month: string;
  onMonth: (ym: string) => void;
  selected: string | null;
  onPick: (iso: string) => void;
  lang: Lang;
  /** ISO bounds; dates outside are disabled */
  min?: string;
  max?: string;
  /** extra rule for a disabled date (P11: no OPEN frame) */
  isDisabled?: (iso: string) => boolean;
  /** content under the day number (P11 ○ △ × —, A01 kinds) */
  mark?: (iso: string) => React.ReactNode;
  /** dates drawn red as Sundays (holidays, F4-02) */
  isHoliday?: (iso: string) => boolean;
  ariaLabel: string;
  /** focus the grid on mount (DateField popover) */
  autoFocus?: boolean;
};

export function MonthGrid(p: MonthGridProps) {
  const id = useId();
  const today = todayJst();
  const off = (iso: string) => (p.min !== undefined && iso < p.min) || (p.max !== undefined && iso > p.max) || !!p.isDisabled?.(iso);
  const [cursor, setCursor] = useState(p.selected && monthOf(p.selected) === p.month ? p.selected : `${p.month}-01`);
  const gridRef = useRef<HTMLDivElement>(null);
  const cur = monthOf(cursor) === p.month ? cursor : `${p.month}-01`;
  const first = firstWeekday(p.lang);
  const heads = Array.from({ length: 7 }, (_, i) => HEAD[p.lang][(first + i) % 7]);

  useEffect(() => {
    if (p.autoFocus) gridRef.current?.focus();
  }, [p.autoFocus]);

  function onKey(e: React.KeyboardEvent) {
    const step = stepOf(e.key);
    if (step !== null) {
      const next = addDays(cur, step);
      setCursor(next);
      if (monthOf(next) !== p.month) p.onMonth(monthOf(next));
    } else if (e.key === "Enter" || e.key === " ") {
      if (!off(cur)) p.onPick(cur);
    } else return;
    e.preventDefault();
  }

  return (
    <div>
      <div className="mg-head">
        <button type="button" className="btn bs btn-sm" onClick={() => p.onMonth(shiftMonth(p.month, -1))}>‹ {label("calPrev", p.lang)}</button>
        <b aria-live="polite">{formatMonthHeading(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)), p.lang)}</b>
        <button type="button" className="btn bs btn-sm" onClick={() => p.onMonth(shiftMonth(p.month, 1))}>{label("calNext", p.lang)} ›</button>
      </div>
      <div className="mg-wd" aria-hidden>{heads.map((h) => <span key={h}>{h}</span>)}</div>
      <div
        ref={gridRef} className="mg-grid" role="grid" aria-label={p.ariaLabel} tabIndex={0} onKeyDown={onKey}
        aria-activedescendant={`${id}-${cur}`}
      >
        {monthCells(p.month, first).map((iso, i) => {
          if (!iso) return <span key={`b${i}`} />;
          const wd = weekdayOf(iso);
          const cls = ["mg-cell", wd === 0 || p.isHoliday?.(iso) ? "sun" : wd === 6 ? "sat" : "", iso === today ? "today" : "", iso === cur ? "cur" : ""];
          return (
            <button
              key={iso} id={`${id}-${iso}`} type="button" role="gridcell" tabIndex={-1} className={cls.join(" ")} disabled={off(iso)}
              aria-selected={iso === p.selected} aria-label={formatDate(iso, p.lang)} aria-current={iso === today ? "date" : undefined}
              onClick={() => { setCursor(iso); p.onPick(iso); }}
            >
              <span>{Number(iso.slice(8))}</span>
              {p.mark && <span className="mg-mark">{p.mark(iso)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type DateFieldProps = {
  id: string;
  /** the text as typed (「YYYY/MM/DD」) */
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  lang: Lang;
  ariaLabel: string;
  min?: string;
  max?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** default 「YYYY/MM/DD」 (A02 8-2 shows 「（無期限）」) */
  placeholder?: string;
};

export function DateField(p: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const picked = parseDateText(p.value);
  const [month, setMonth] = useState(monthOf(picked ?? p.min ?? todayJst()));
  const inputRef = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="dp" onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <input
        ref={inputRef} id={p.id} className="inp" value={p.value} placeholder={p.placeholder ?? "YYYY/MM/DD"} inputMode="numeric" maxLength={10} aria-label={p.ariaLabel}
        aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy} disabled={p.disabled} autoFocus={p.autoFocus}
        onChange={(e) => p.onChange(e.target.value)} onBlur={p.onBlur}
      />
      <button
        type="button" className="ib" aria-label={label("calOpen", p.lang)} aria-expanded={open} disabled={p.disabled}
        onClick={() => { setMonth(monthOf(picked ?? p.min ?? todayJst())); setOpen(!open); }}
      >
        <Icon name="cal" size={20} />
      </button>
      {open && (
        <div className="dp-pop" role="dialog" aria-label={p.ariaLabel}>
          <MonthGrid
            month={month} onMonth={setMonth} selected={picked} lang={p.lang} min={p.min} max={p.max} ariaLabel={p.ariaLabel} autoFocus
            onPick={(iso) => { p.onChange(isoToText(iso)); close(); }}
          />
        </div>
      )}
    </div>
  );
}
