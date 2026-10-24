"use client";

// spec-screen: A01
// 診療カレンダー・休診日: four tabs (診療時間 / カレンダー / 祝日 / クリニック情報). State 基 (ADMIN), ① (RECEPTION: every input read-only,
// buttons 12 / 14 / 18 / 29 not rendered), ② past date, ③ B3 running, ④ holiday + 臨時診療, ⑤ SW040, ⑥ 期間で設定. Edits of 3-5 and
// 7-12 are held on the page until 保存する (Q2).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, trapTab } from "@/components/ui/ConfirmDialog";
import { ErrorSummary, FieldError, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import type { CalendarState, ClinicProfile, RunInfo } from "@/lib/admin/calendar";
import {
  addDaysIso, BAND_JA, BANDS, CLINIC_KEYS, cellField, dayField, daysInRange, KIND_JA, validateClinic, validateDay, validateHours, validateRange, WEEKDAY_JA, WEEK_ORDER,
  type ClinicValues, type DayKind, type DayValues, type HoursCellValues,
} from "@/lib/admin/calendar-rules";
import { parseB3Message } from "@/lib/batch/b3-message";
import type { FieldError as FieldErr } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import s from "./calendar.module.css";

type Role = "ADMIN" | "RECEPTION";
type Tab = "hours" | "calendar" | "holidays" | "clinic";
type Answer = { code?: string; params?: Record<string, string | number>; errors?: FieldErr[]; state?: CalendarState; n?: number; since?: string };

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "hours", label: "診療時間" }, { id: "calendar", label: "カレンダー" }, { id: "holidays", label: "祝日" }, { id: "clinic", label: "クリニック情報" },
];
const URL = {
  state: "/api/admin/calendar/state", day: "/api/admin/calendar/day", check: "/api/admin/calendar/check", save: "/api/admin/calendar/save",
  clinic: "/api/admin/calendar/clinic", holidays: "/api/admin/calendar/holidays",
};
const STATUS_JA: Record<string, string> = { SUCCESS: "正常終了", PARTIAL: "一部エラー", FAILED: "失敗", RUNNING: "実行中" };
const KIND_OPTIONS: DayKind[] = ["NORMAL", "CLOSED", "AM_CLOSED", "PM_CLOSED", "SPECIAL_OPEN"];
const OMITTED = "実行中のため省略";

const fid = (field: string) => `a01-${field.replace(/\./g, "-")}`;
const blankDay = (date: string): DayValues => ({ date, kind: "NORMAL", amOpen: "", amClose: "", pmOpen: "", pmClose: "", noteJa: "", noteEn: "", noteVi: "" });
const pad = (n: number) => String(n).padStart(2, "0");
/** Asia/Tokyo wall clock of an instant: [YYYY, M, D, HH, mm] */
function jst(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), pad(d.getUTCHours()), pad(d.getUTCMinutes())] as const;
}
const sameDay = (a: DayValues, b: DayValues) => JSON.stringify(a) === JSON.stringify(b);
const weekdayIso = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export function CalendarClient({ role, initial, clinic }: { role: Role; initial: CalendarState; clinic: ClinicProfile }) {
  const { toast } = useToast();
  const api = useApiFetch();
  const router = useRouter();
  const admin = role === "ADMIN";
  const [tab, setTab] = useState<Tab>("calendar");
  const [st, setSt] = useState(initial);
  const [hours, setHours] = useState<HoursCellValues[]>(initial.hours);
  const [held, setHeld] = useState<Record<string, DayValues>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [cursor, setCursor] = useState(`${initial.ym}-01`);
  const [booked, setBooked] = useState(0);
  const [errors, setErrors] = useState<FieldErr[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [sw040, setSw040] = useState<number | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [range, setRange] = useState({ start: "", end: "", kind: "CLOSED" as DayKind });
  const [rangeErrors, setRangeErrors] = useState<FieldErr[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(initial.b3?.status === "RUNNING");
  const [cv, setCv] = useState<ClinicValues>(() => Object.fromEntries(CLINIC_KEYS.map((k) => [k, clinic[k]])) as ClinicValues);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const msg = (e: FieldErr) => t(e.code, "ja", e.params);
  const err = (field: string) => { const e = errors.find((x) => x.field === field); return e ? msg(e) : null; };
  const storedDay = (date: string) => (st.days.some((d) => d.date === date) ? st.days.find((d) => d.date === date)! : blankDay(date));
  const current = (date: string) => held[date] ?? storedDay(date);
  const inMonth = (date: string) => date.startsWith(st.ym);
  const hoursDirty = JSON.stringify(hours) !== JSON.stringify(st.hours);
  const dirty = hoursDirty || Object.keys(held).length > 0;

  /** an answer; null when the request failed or an error screen opened */
  async function call(url: string, init?: RequestInit) {
    const res = await api(url, init);
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Answer };
  }
  const clear = () => { setErrors([]); setBanner(null); };

  async function loadState(ym: string) {
    const r = await call(`${URL.state}?ym=${ym}`);
    if (r?.ok && r.json.state) {
      setSt(r.json.state);
      return r.json.state;
    }
    return null;
  }
  async function refresh(ym = st.ym) {
    const next = await loadState(ym);
    if (next) setHours(next.hours);
    return next;
  }

  /** errors of a failed check / save: SE043 is a banner, field errors go under the field and into the summary */
  function show(list: FieldErr[]) {
    if (list.some((e) => e.code === "SE043")) setBanner(t("SE043", "ja"));
    const fields = list.filter((e) => e.code !== "SE043");
    setErrors(fields);
    const first = fields[0]?.field;
    if (!first) return;
    setTab(first.startsWith("h.") ? "hours" : "calendar");
    if (first.startsWith("day.")) setPicked(first.split(".")[1]);
    setTimeout(() => document.getElementById(fid(first))?.focus(), 0);
  }
  /** event 3: only the field that was left is re-checked */
  function blur(field: string, all: FieldErr[]) {
    setErrors((prev) => [...prev.filter((e) => e.field !== field), ...all.filter((e) => e.field === field)]);
  }

  // ── 診療時間 ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const setCell = (wd: number, band: "AM" | "PM", patch: Partial<HoursCellValues>) =>
    setHours((h) => h.map((c) => (c.weekday === wd && c.band === band ? { ...c, ...patch } : c)));

  function renderHours() {
    const input = (c: HoursCellValues, box: "open" | "close" | "reception") => {
      const f = cellField(c.weekday, c.band, box);
      return (
        <input
          id={fid(f)} className={`inp ${s.time}`} value={c[box]} readOnly={!admin} inputMode="numeric" aria-invalid={err(f) ? true : undefined}
          aria-label={`${WEEKDAY_JA[c.weekday]}曜 ${BAND_JA[c.band]} ${box === "open" ? "開始" : box === "close" ? "終了" : "受付終了"}`}
          onChange={(e) => setCell(c.weekday, c.band, { [box]: e.target.value })}
          onBlur={() => blur(f, validateHours(hours))}
        />
      );
    };
    return (
      <div className={s.panel}>
        <table className={s.table}>
          <thead>
            <tr><th>曜日</th><th>午前 診療あり</th><th>開始〜終了</th><th>受付終了</th><th>午後 診療あり</th><th>開始〜終了</th><th>受付終了</th></tr>
          </thead>
          <tbody>
            {WEEK_ORDER.map((wd) => (
              <tr key={wd}>
                <td className={wd === 0 ? s.sun : wd === 6 ? s.sat : ""}><b>{WEEKDAY_JA[wd]}</b></td>
                {BANDS.map((band) => {
                  const c = hours.find((x) => x.weekday === wd && x.band === band)!;
                  const errs = ["open", "close", "reception"].map((b) => err(cellField(wd, band, b as "open"))).filter(Boolean);
                  return [
                    <td key={`${band}c`}>
                      <input
                        type="checkbox" checked={c.on} disabled={!admin} aria-label={`${WEEKDAY_JA[wd]}曜 ${BAND_JA[band]} 診療あり`}
                        onChange={(e) => setCell(wd, band, { on: e.target.checked })}
                      />
                    </td>,
                    <td key={`${band}t`}>
                      {c.on ? <span className="row">{input(c, "open")}〜{input(c, "close")}</span> : <span className={s.off}>休診</span>}
                      {errs.map((m, i) => <FieldError key={i} id={`e-${wd}-${band}-${i}`} message={m} />)}
                    </td>,
                    <td key={`${band}r`}>{c.on ? input(c, "reception") : <span className={s.off}>—</span>}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── カレンダー ───────────────────────────────────────────────────────────────────────────────────────────────────
  const [y, m] = st.ym.split("-").map(Number);
  const firstWd = weekdayIso(`${st.ym}-01`);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dateOf = (n: number) => `${st.ym}-${pad(n)}`;

  async function pick(date: string) {
    setPicked(date);
    setCursor(date);
    clear();
    setBooked(0);
    if (date < st.today) {
      if (admin) setBanner(t("SE043", "ja"));
      return;
    }
    const r = await call(`${URL.day}?date=${date}`);
    if (r?.ok) setBooked(r.json.n ?? 0);
  }
  async function moveMonth(delta: number) {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const ym = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    setPicked(null);
    clear();
    const next = await loadState(ym);
    if (next) setCursor(`${ym}-01`);
  }
  function onGridKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 7 : e.key === "ArrowUp" ? -7 : 0;
    if (step) {
      const next = addDaysIso(cursor, step);
      if (inMonth(next)) setCursor(next);
    } else if (e.key === "Enter") void pick(cursor);
    else return;
    e.preventDefault();
  }

  /** hold values for dates; a value equal to the stored row is not held (nothing to save) */
  function hold(values: DayValues[]) {
    setHeld((prev) => {
      const next = { ...prev };
      for (const v of values) {
        if (inMonth(v.date) && sameDay(v, storedDay(v.date))) delete next[v.date];
        else next[v.date] = v;
      }
      return next;
    });
  }
  const edit = (patch: Partial<DayValues>) => picked && hold([{ ...current(picked), ...patch }]);

  function marks(date: string) {
    const d = current(date);
    const holiday = st.holidays.find((h) => h.date === date);
    const out: Array<[string, string]> = [];
    if (d.kind === "CLOSED") out.push([s.mClosed, "休診"]);
    else if (d.kind === "AM_CLOSED") out.push([s.mHalf, "午前休診"]);
    else if (d.kind === "PM_CLOSED") out.push([s.mHalf, "午後休診"]);
    else if (d.kind === "SPECIAL_OPEN") out.push([s.mSpecial, "臨時診療"]);
    else if (!st.hours.some((c) => c.weekday === weekdayIso(date) && c.on)) out.push([s.mRegular, "定休"]);
    if (holiday) out.unshift([s.mHoliday, holiday.nameJa]);
    return out;
  }

  function renderCalendar() {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstWd; i++) cells.push(<div key={`b${i}`} className={`${s.cell} ${s.empty}`} />);
    for (let n = 1; n <= dim; n++) {
      const date = dateOf(n);
      const wd = (firstWd + n - 1) % 7;
      cells.push(
        <button
          key={date} id={`a01-d-${date}`} type="button" tabIndex={-1} aria-current={date === st.today ? "date" : undefined}
          className={`${s.cell} ${date < st.today ? s.past : ""} ${date === st.today ? s.today : ""} ${date === picked ? s.picked : ""}`}
          onClick={() => void pick(date)}
        >
          <span className={`${s.num} ${wd === 0 ? s.sun : wd === 6 ? s.sat : ""}`}>{n}</span>
          <div>{marks(date).map(([c, label]) => <span key={label} className={`${s.mark} ${c}`}>{label}</span>)}</div>
          {current(date).noteJa && <span className={s.note}>{current(date).noteJa}</span>}
        </button>,
      );
    }
    const past = picked !== null && picked < st.today;
    const ro = !admin || past;
    const d = picked ? current(picked) : null;
    const timeBox = (k: "amOpen" | "amClose" | "pmOpen" | "pmClose", label: string) => (
      <input
        className="inp" value={d?.[k] ?? ""} readOnly={ro} disabled={d?.kind !== "SPECIAL_OPEN"} aria-label={label} placeholder="HH:MM"
        id={fid(`${k}`)} onChange={(e) => edit({ [k]: e.target.value })}
        onBlur={() => d && setErrors((prev) => [...prev.filter((x) => x.field !== dayField(d.date, "times")), ...validateDay(d, st.today).filter((x) => x.field === dayField(d.date, "times"))])}
      />
    );
    return (
      <div className={s.split}>
        <div className={s.panel}>
          <div className={s.month}>
            <Button variant="secondary" className="btn-sm" onClick={() => void moveMonth(-1)}>‹ 前月</Button>
            <b>{y}年{m}月</b>
            <Button variant="secondary" className="btn-sm" onClick={() => void moveMonth(1)}>翌月 ›</Button>
            <span className="sp" />
            {admin && <Button variant="secondary" className="btn-sm" onClick={() => { setRange({ start: "", end: "", kind: "CLOSED" }); setRangeErrors([]); setRangeOpen(true); }}><Icon name="cal" size={16} />期間で設定</Button>}
          </div>
          <div className={s.grid} aria-hidden>
            {WEEKDAY_JA.map((w, i) => <div key={w} className={`${s.wd} ${i === 0 ? s.sun : i === 6 ? s.sat : ""}`}>{w}</div>)}
          </div>
          <div
            className={s.grid} role="group" aria-label="診療カレンダー" tabIndex={0} onKeyDown={onGridKey}
            onFocus={() => document.getElementById(`a01-d-${cursor}`)?.classList.add(s.picked)} onBlur={() => document.getElementById(`a01-d-${cursor}`)?.classList.remove(s.picked)}
          >
            {cells}
          </div>
          <div className={s.legend}>
            <span className={`${s.mark} ${s.mClosed}`}>休診</span><span className={`${s.mark} ${s.mHalf}`}>午前休診 / 午後休診</span>
            <span className={`${s.mark} ${s.mSpecial}`}>臨時診療</span><span className={`${s.mark} ${s.mHoliday}`}>祝日</span>
            <span>灰色＝過去（編集不可）</span><span>枠線＝今日</span>
          </div>
        </div>
        {picked && d && (
          <div className={`${s.panel} ${s.side}`}>
            <h2>{Number(picked.slice(5, 7))}月{Number(picked.slice(8))}日({WEEKDAY_JA[weekdayIso(picked)]}) <small className="mut">の設定</small></h2>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={ro}>
              <legend className="row"><b>種別</b> <RequiredMark lang="ja" /></legend>
              <div className={s.radios} role="radiogroup">
                {KIND_OPTIONS.map((k) => (
                  <label key={k}>
                    <input type="radio" name="a01-kind" checked={d.kind === k} onChange={() => edit({ kind: k })} />
                    {KIND_JA[k]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row"><b>臨時診療の時間</b> <span className="mut xs">臨時診療のとき1つ以上</span></div>
            <div className={s.times}><span>午前</span>{timeBox("amOpen", "午前 開始")}<span>〜</span>{timeBox("amClose", "午前 終了")}</div>
            <div className={s.times}><span>午後</span>{timeBox("pmOpen", "午後 開始")}<span>〜</span>{timeBox("pmClose", "午後 終了")}</div>
            <FieldError id="e-times" message={err(dayField(picked, "times"))} />
            <div className="row" style={{ marginTop: 8 }}><b>患者向けお知らせ</b> <span className="mut xs">任意・各200文字・P10 / P11 に表示</span></div>
            {(["noteJa", "noteEn", "noteVi"] as const).map((k, i) => (
              <div key={k}>
                <div className={s.lang}>
                  <span>{["JA", "EN", "VI"][i]}</span>
                  <input
                    id={fid(dayField(picked, k))} className="inp" value={d[k]} readOnly={ro} disabled={d.kind === "NORMAL"}
                    placeholder={i === 0 ? "" : "未入力の場合は日本語を表示"} aria-label={`患者向けお知らせ ${["JA", "EN", "VI"][i]}`}
                    onChange={(e) => edit({ [k]: e.target.value })}
                    onBlur={() => blur(dayField(picked, k), validateDay(d, st.today))}
                  />
                </div>
                <FieldError id={`e-${k}`} message={err(dayField(picked, k))} />
              </div>
            ))}
            {!past && booked > 0 && <div className={s.info}>この日に予約済みの枠 {booked}件 → 保存時に確認（要調整になります）</div>}
          </div>
        )}
      </div>
    );
  }

  // ── 祝日 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function importHolidays() {
    clear();
    setImporting(true);
    const r = await call(URL.holidays, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r?.ok) return setImporting(false);
    await poll(r.json.since ?? "");
  }
  /** 抽出7 until the B3 run that began at `since` is no longer RUNNING */
  async function poll(since: string) {
    for (let i = 0; i < 1000 && alive.current; i++) {
      const next = await loadState(st.ym);
      const run = next?.b3;
      if (run && run.startedAt >= since && run.status !== "RUNNING") {
        setImporting(false);
        if (run.status === "FAILED") setBanner(t("SE041", "ja", { 理由: run.message ?? "" }));
        else if (run.message !== OMITTED) {
          const c = parseB3Message(run.message);
          toast("SI041", { params: c });
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  useEffect(() => {
    if (initial.b3?.status === "RUNNING") void poll("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runLine = (r: RunInfo | null, kind: "b2" | "b3") => {
    if (!r) return null;
    if (kind === "b2") {
      if (r.status === "RUNNING" || !r.endedAt) return "前回の枠生成 実行中";
      const [, mo, d, hh, mi] = jst(r.endedAt);
      return `前回の枠生成 ${mo}/${d} ${hh}:${mi} ${STATUS_JA[r.status] ?? r.status}（${r.written.toLocaleString("en-US")}枠）`;
    }
    const [yy, mo, d, hh, mi] = jst(r.startedAt);
    return `${yy}/${pad(mo)}/${pad(d)} ${hh}:${mi} ${STATUS_JA[r.status] ?? r.status}${r.message ? `（${r.message}）` : ""}`;
  };

  function renderHolidays() {
    return (
      <div className={s.panel}>
        {st.b3 && <div className={s.chip} style={{ marginBottom: 8 }}>前回の祝日取込 {runLine(st.b3, "b3")}</div>}
        {admin && <Button variant="secondary" disabled={importing} onClick={() => void importHolidays()}><Icon name="refresh" size={16} />{importing ? "取込中" : "祝日を取り込む"}</Button>}
        <table className={s.table} style={{ marginTop: 12 }}>
          <thead><tr><th>日付</th><th>名称</th></tr></thead>
          <tbody>
            {st.holidayList.map((h) => (
              <tr key={h.date} className={h.isActive ? "" : s.strike}>
                <td>{h.date.replace(/-/g, "/")}({WEEKDAY_JA[weekdayIso(h.date)]})</td><td>{h.nameJa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── クリニック情報 ───────────────────────────────────────────────────────────────────────────────────────────────
  async function saveClinic() {
    clear();
    const local = validateClinic(cv);
    if (local.length > 0) {
      setErrors(local);
      setTimeout(() => document.getElementById(fid(local[0].field))?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      const r = await call(...postJson(URL.clinic, cv));
      if (!r) return;
      if (r.ok) {
        toast("SI042");
        router.refresh();
      } else if (r.json.errors) setErrors(r.json.errors);
      else setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
    } finally {
      setBusy(false);
    }
  }

  function renderClinic() {
    const text = (k: keyof ClinicValues, o: { area?: boolean; ph?: string; label: string } = { label: "" }) => {
      const f = `clinic.${k}`;
      const props = {
        id: fid(f), className: "inp", value: cv[k], readOnly: !admin, placeholder: o.ph, "aria-label": o.label || undefined,
        "aria-invalid": err(f) ? true : undefined,
        onChange: (e: { target: { value: string } }) => setCv({ ...cv, [k]: e.target.value }),
        onBlur: () => blur(f, validateClinic(cv)),
      };
      return (
        <div>
          {o.area ? <textarea {...props} rows={3} /> : <input type="text" {...props} />}
          <FieldError id={`e-${f}`} message={err(f)} />
        </div>
      );
    };
    const row = (label: string, req: string | null, body: React.ReactNode) => (
      <div className={s.f}><div className={s.lab}>{label}{req === "" ? <RequiredMark lang="ja" /> : req && <span className="req">{req}</span>}</div>{body}</div>
    );
    return (
      <div className={s.panel}>
        {row("クリニックコード", null, <div style={{ paddingTop: 8 }}><code>{clinic.code}</code></div>)}
        {row("クリニック名", "", <div className={s.cols}>{text("nameJa", { label: "クリニック名 JA" })}{text("nameEn", { label: "クリニック名 EN" })}{text("nameVi", { label: "クリニック名 VI", ph: "VI" })}</div>)}
        {row("クリニック名カナ", "", text("nameKana", { label: "クリニック名カナ" }))}
        {row("郵便番号", "", text("postcode", { label: "郵便番号" }))}
        {row("住所", "", <div className={s.cols}>{text("prefecture", { label: "都道府県" })}{text("city", { label: "市区町村" })}{text("addressLine", { label: "番地・建物名" })}</div>)}
        {row("住所（英語表記）", null, text("addressEn", { label: "住所（英語表記）" }))}
        {row("電話番号", "", text("phone", { label: "電話番号" }))}
        {row("アクセス", "必須 (JA)", <div className={s.cols}>{text("accessJa", { area: true, label: "アクセス JA" })}{text("accessEn", { area: true, label: "アクセス EN" })}{text("accessVi", { area: true, label: "アクセス VI", ph: "VI" })}</div>)}
        {row("地図URL", null, text("mapUrl", { label: "地図URL" }))}
        {row("お知らせ", null, <div className={s.cols}>{text("noticeJa", { area: true, label: "お知らせ JA" })}{text("noticeEn", { area: true, label: "お知らせ EN" })}{text("noticeVi", { area: true, label: "お知らせ VI", ph: "VI" })}</div>)}
        {admin && <div className={s.bar}><span /><Button busy={busy} onClick={() => void saveClinic()}>保存する（クリニック情報）</Button></div>}
      </div>
    );
  }

  // ── 保存する (events 4 / 5) ──────────────────────────────────────────────────────────────────────────────────────
  const heldList = () => Object.values(held);
  async function save() {
    clear();
    const local = [...validateHours(hours), ...heldList().flatMap((d) => validateDay(d, st.today))];
    if (local.length > 0) return show(local);
    setBusy(true);
    try {
      const r = await call(...postJson(URL.check, { hours, days: heldList() }));
      if (!r) return;
      if (!r.ok) return r.json.errors ? show(r.json.errors) : setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
      if ((r.json.n ?? 0) > 0) setSw040(r.json.n ?? 0);
      else await commit();
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    const r = await call(...postJson(URL.save, { hours, days: heldList() }));
    setSw040(null);
    if (!r) return;
    if (r.ok) {
      toast("SI040", { params: r.json.params });
      setHeld({});
      await refresh();
    } else if (r.status === 409) {
      setBanner(t("SE044", "ja"));
      setHeld({});
      await refresh();
    } else if (r.json.errors) show(r.json.errors);
    else setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
  }

  // ── 期間で設定 (events 13-15) ────────────────────────────────────────────────────────────────────────────────────
  function applyRange() {
    const start = range.start.trim().replace(/\//g, "-");
    const end = range.end.trim().replace(/\//g, "-");
    const errs = validateRange(start, end, st.today);
    setRangeErrors(errs);
    if (errs.length > 0) return;
    hold(daysInRange(start, end).map((date) => (range.kind === "NORMAL" ? blankDay(date) : { ...current(date), kind: range.kind })));
    setRangeOpen(false);
  }

  const tabKeys = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n !== null) { e.preventDefault(); const next = TABS[(n + TABS.length) % TABS.length].id; setTab(next); setTimeout(() => document.getElementById(`a01-tab-${next}`)?.focus(), 0); }
  };
  const summary = errors.map((e) => ({ fieldId: fid(e.field), message: msg(e) }));
  const b2line = runLine(st.b2, "b2");

  return (
    <div>
      <div className={s.top}>
        <h1 className={s.h1}>診療カレンダー</h1>
        <div className={s.chips}>
          {b2line && <span className={s.chip}>{b2line}</span>}
          {st.adjustCount > 0 && <Link className={s.warn} href="/staff/ledger?filter=adjust"><Icon name="alert" size={16} /> 要調整 {st.adjustCount}件</Link>}
        </div>
      </div>
      <div className={s.tabs} role="tablist" aria-label="診療カレンダー">
        {TABS.map((x, i) => (
          <button
            key={x.id} id={`a01-tab-${x.id}`} type="button" role="tab" aria-selected={tab === x.id} tabIndex={tab === x.id ? 0 : -1}
            className={`${s.tab} ${tab === x.id ? s.tabOn : ""}`} onClick={() => setTab(x.id)} onKeyDown={(e) => tabKeys(e, i)}
          >
            {x.label}
          </button>
        ))}
      </div>
      {banner && <div className="err" role="alert" style={{ marginBottom: 12 }}><Icon name="alert" /> {banner}</div>}
      <ErrorSummary errors={summary} lang="ja" />
      {tab === "hours" && renderHours()}
      {tab === "calendar" && renderCalendar()}
      {tab === "holidays" && renderHolidays()}
      {tab === "clinic" && renderClinic()}
      {admin && (tab === "hours" || tab === "calendar") && (
        <div className={s.bar}>
          <span className="mut xs">保存すると対象日の枠を再生成します（予約は取り消さず「要調整」にします）。</span>
          <Button busy={busy} disabled={!dirty} onClick={() => void save()}>保存する</Button>
        </div>
      )}
      <ConfirmDialog
        open={sw040 !== null} title="予約がある枠が閉じます" messageId="SW040" params={{ n: sw040 ?? 0 }} onConfirm={commit} onCancel={() => setSw040(null)}
      />
      {rangeOpen && (
        <div className="scrim-fixed" onKeyDown={(e) => { if (e.key === "Escape") setRangeOpen(false); trapTab(e); }}>
          <div className="dlg" role="dialog" aria-modal="true" aria-label="期間で設定">
            <h3>期間で設定</h3>
            <div className={s.dlgRow}>
              <input id="a01-range-start" className="inp" autoFocus placeholder="YYYY/MM/DD" aria-label="開始日" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
              〜
              <input id="a01-range-end" className="inp" placeholder="YYYY/MM/DD" aria-label="終了日" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
            </div>
            {rangeErrors.map((e) => <FieldError key={e.field} id={`e-${e.field}`} message={msg(e)} />)}
            <div className={s.radios} role="radiogroup">
              {(["NORMAL", "CLOSED", "AM_CLOSED", "PM_CLOSED"] as DayKind[]).map((k) => (
                <label key={k}><input type="radio" name="a01-range-kind" checked={range.kind === k} onChange={() => setRange({ ...range, kind: k })} />{KIND_JA[k]}</label>
              ))}
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn bs" onClick={() => setRangeOpen(false)}>キャンセル</button>
              <Button onClick={applyRange}>設定する</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
