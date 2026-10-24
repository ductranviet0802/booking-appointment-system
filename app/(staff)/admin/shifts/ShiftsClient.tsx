"use client";

// spec-screen: A02
// 医師シフト: doctor list (1), 定型シフト table (2-9), 例外 panel (10-17), 週表示 (18), 保存する (19), 要調整 link (20).
// State 基 (ADMIN), ① (RECEPTION: all values read-only, add form / 行追加 / 削除 / 保存する not rendered), ② (DOCTOR: own only, as ① and no
// 要調整 link), ③ SW041. Edits are held on the page until 保存する (Q9); picking another doctor discards them.
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorSummary, FieldError, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { addDaysIso } from "@/lib/admin/calendar-rules";
import type { DoctorItem, ExceptionRow, PatternRow, ShiftDetail, WeekView } from "@/lib/admin/shifts";
import {
  BAND_LABEL, EXC_LABEL, findOverlap, overlapError, validateException, validatePattern, WEEKDAY_JA, WEEK_ORDER,
  type BandHours, type ExceptionValues, type ExcKind, type PatternRef, type PatternValues,
} from "@/lib/admin/shifts-rules";
import type { FieldError as FieldErr } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import s from "./shifts.module.css";

type Role = "ADMIN" | "RECEPTION" | "DOCTOR";
type Answer = { code?: string; params?: Record<string, string | number>; errors?: FieldErr[]; n?: number; detail?: ShiftDetail; week?: WeekView; adjustCount?: number; bands?: Array<{ band: "AM" | "PM"; open: string; close: string }> };
type Row = { key: string; stored: PatternRow | null; v: PatternValues; removed: boolean };
type Held = ExceptionValues & { key: string };

const URL = { detail: "/api/admin/shifts/detail", week: "/api/admin/shifts/week", hours: "/api/admin/shifts/hours", check: "/api/admin/shifts/check", save: "/api/admin/shifts/save" };
const slash = (iso: string) => iso.replace(/-/g, "/");
const iso = (v: string) => v.trim().replace(/\//g, "-");
const wdOf = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();
const dateLabel = (d: string) => `${slash(d)}(${WEEKDAY_JA[wdOf(d)]})`;
const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${WEEKDAY_JA[wdOf(d)]})`;
const blankForm = (): ExceptionValues => ({ date: "", kind: "", band: "", departmentId: "", start: "", end: "", substituteDoctorId: "", note: "" });
const KIND_CLASS: Record<ExcKind, string> = { OFF: s.bOff, EXTRA: s.bExtra, SUBSTITUTE: s.bSub };
let seq = 0;

const rowsOf = (d: ShiftDetail | null): Row[] =>
  (d?.patterns ?? []).map((p) => ({
    key: p.id, stored: p, removed: false,
    v: { id: p.id, departmentId: p.departmentId, weekday: String(p.weekday), band: p.band, start: p.start, end: p.end, validFrom: slash(p.validFrom), validTo: p.validTo ? slash(p.validTo) : "" },
  }));
/** the values as the request / the checks read them (ISO dates) */
const wire = (v: PatternValues): PatternValues => ({ ...v, validFrom: iso(v.validFrom), validTo: iso(v.validTo) });
const wireOfStored = (p: PatternRow): PatternValues => ({ id: p.id, departmentId: p.departmentId, weekday: String(p.weekday), band: p.band, start: p.start, end: p.end, validFrom: p.validFrom, validTo: p.validTo ?? "" });
const changed = (r: Row) => r.removed || !r.stored || JSON.stringify(wire(r.v)) !== JSON.stringify(wireOfStored(r.stored));

export function ShiftsClient({ role, today, doctors, detail: initial, week: initialWeek, adjustCount: initialCount }: {
  role: Role; today: string; doctors: DoctorItem[]; detail: ShiftDetail | null; week: WeekView; adjustCount: number;
}) {
  const { toast } = useToast();
  const api = useApiFetch();
  const admin = role === "ADMIN";
  const [doctorId, setDoctorId] = useState(initial?.doctorId ?? "");
  const [detail, setDetail] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(initial));
  const [adds, setAdds] = useState<Held[]>([]);
  const [removedExc, setRemovedExc] = useState<string[]>([]);
  const [form, setForm] = useState<ExceptionValues>(blankForm());
  const [week, setWeek] = useState(initialWeek);
  const [adjust, setAdjust] = useState(initialCount);
  const [errors, setErrors] = useState<FieldErr[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [sw041, setSw041] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const msg = (e: FieldErr) => t(e.code, "ja", e.params);
  const err = (field: string) => { const e = errors.find((x) => x.field === field); return e ? msg(e) : null; };
  const rowErrs = (key: string) => errors.filter((e) => e.field.startsWith(`p.${key}.`));
  const clinicId = detail?.choices.clinicId ?? "";
  const hoursOf = (weekday: number, band: "AM" | "PM"): BandHours => {
    const h = detail?.choices.hours.find((x) => x.weekday === weekday && x.band === band);
    return h ? { open: h.open, close: h.close } : null;
  };
  const dirty = rows.some(changed) || adds.length > 0 || removedExc.length > 0;

  async function call(url: string, init?: RequestInit) {
    const res = await api(url, init);
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Answer };
  }
  function reset(d: ShiftDetail | null) {
    setDetail(d);
    setRows(rowsOf(d));
    setAdds([]);
    setRemovedExc([]);
    setForm(blankForm());
    setErrors([]);
    setBanner(null);
  }
  async function loadWeek(start: string) {
    const r = await call(`${URL.week}?start=${start}`);
    if (r?.ok && r.json.week) {
      setWeek(r.json.week);
      setAdjust(r.json.adjustCount ?? 0);
    }
  }
  // event 2: another doctor discards the held values (Q9)
  async function pick(id: string) {
    if (id === doctorId) return;
    const r = await call(`${URL.detail}?doctorId=${id}`);
    if (r?.ok && r.json.detail) {
      setDoctorId(id);
      reset(r.json.detail);
    }
  }
  function onDocKey(e: React.KeyboardEvent) {
    const i = doctors.findIndex((d) => d.id === doctorId);
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null || !doctors[next]) return;
    e.preventDefault();
    void pick(doctors[next].id);
    setTimeout(() => document.getElementById(`a02-doc-${doctors[next].id}`)?.focus(), 0);
  }

  // ── 定型シフト ──────────────────────────────────────────────────────────────────────────────────────────────────
  const patch = (key: string, p: Partial<PatternValues>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, v: { ...r.v, ...p } } : r)));
  const addRow = () => setRows((rs) => [...rs, { key: `n${++seq}`, stored: null, removed: false, v: { id: null, departmentId: "", weekday: "", band: "AM", start: "", end: "", validFrom: "", validTo: "" } }]);
  const dropRow = (r: Row) => setRows((rs) => (r.stored ? rs.map((x) => (x.key === r.key ? { ...x, removed: true } : x)) : rs.filter((x) => x.key !== r.key)));
  const live = rows.filter((r) => !r.removed);
  const refOf = (r: Row): PatternRef => {
    const w = wire(r.v);
    return { weekday: Number(w.weekday), start: w.start.trim(), end: w.end.trim(), validFrom: w.validFrom, validTo: w.validTo || null, clinicName: r.stored?.clinicName ?? detail?.choices.clinicName ?? "" };
  };
  /** the mode of a row: which parts are inputs (4-3) */
  const mode = (r: Row): "other" | "ended" | "effect" | "edit" =>
    r.stored && r.stored.clinicId !== clinicId ? "other"
      : r.stored?.validTo && r.stored.validTo < today ? "ended"
      : r.stored && r.stored.validFrom <= today ? "effect" : "edit";
  const rowChecks = (r: Row): FieldErr[] => {
    const m = mode(r);
    const out = validatePattern(wire(r.v), r.key, { today, hours: hoursOf, only: m === "effect" ? "validTo" : undefined });
    if (out.length === 0) {
      const hit = findOverlap(wire(r.v), live.filter((x) => x !== r).map(refOf));
      if (hit) out.push(overlapError(`p.${r.key}.row`, hit));
    }
    return out;
  };
  const blurRow = (r: Row) => setErrors((prev) => [...prev.filter((e) => !e.field.startsWith(`p.${r.key}.`)), ...validatePattern(wire(r.v), r.key, { today, hours: hoursOf, only: mode(r) === "effect" ? "validTo" : undefined })]);

  function renderPatterns() {
    const canEdit = admin;
    const inp = (r: Row, k: "start" | "end" | "validFrom" | "validTo", o: { cls?: string; ph?: string; label: string }) => (
      <input
        id={`a02-p-${r.key}-${k}`} className={`inp ${o.cls ?? s.time}`} value={r.v[k]} placeholder={o.ph} aria-label={o.label} inputMode="numeric"
        onChange={(e) => patch(r.key, { [k]: e.target.value })} onBlur={() => blurRow(r)}
      />
    );
    return (
      <table className={s.table}>
        <thead>
          <tr><th>クリニック</th><th>診療科</th><th>曜日</th><th>時間帯</th><th>開始〜終了</th><th>適用期間</th><th /></tr>
        </thead>
        <tbody>
          {live.map((r) => {
            const m = canEdit ? mode(r) : r.stored ? (mode(r) === "other" ? "other" : mode(r) === "ended" ? "ended" : "view") : "view";
            const full = m === "edit";
            const dept = detail?.choices.departments.find((d) => d.id === r.v.departmentId)?.name ?? r.stored?.departmentName ?? "";
            const errs = rowErrs(r.key);
            const cls = m === "other" ? `${s.grey} ${s.hatch}` : m === "ended" ? s.grey : "";
            const delOk = canEdit && m !== "other" && (!r.stored || r.stored.validFrom > today); // 2-1: no 削除 on another clinic's row
            return (
              <tr key={r.key} className={cls}>
                <td>{r.stored?.clinicName ?? detail?.choices.clinicName}</td>
                <td>
                  {full ? (
                    <select id={`a02-p-${r.key}-departmentId`} className="inp" aria-label="診療科" value={r.v.departmentId} onChange={(e) => patch(r.key, { departmentId: e.target.value })} onBlur={() => blurRow(r)}>
                      <option value="">選択してください</option>
                      {detail?.choices.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  ) : dept}
                </td>
                <td>
                  {full ? (
                    <select id={`a02-p-${r.key}-weekday`} className="inp" aria-label="曜日" value={r.v.weekday} onChange={(e) => patch(r.key, { weekday: e.target.value })} onBlur={() => blurRow(r)}>
                      <option value="">選択してください</option>
                      {WEEK_ORDER.map((w) => <option key={w} value={String(w)}>{WEEKDAY_JA[w]}</option>)}
                    </select>
                  ) : WEEKDAY_JA[Number(r.v.weekday)]}
                </td>
                <td>
                  {full ? (
                    <span className={s.radios} role="radiogroup" aria-label="時間帯">
                      {(["AM", "PM"] as const).map((b) => (
                        <label key={b}><input type="radio" name={`a02-band-${r.key}`} checked={r.v.band === b} onChange={() => patch(r.key, { band: b })} />{BAND_LABEL[b]}</label>
                      ))}
                    </span>
                  ) : r.v.band ? BAND_LABEL[r.v.band] : ""}
                </td>
                <td>
                  {full ? <span className={s.row}>{inp(r, "start", { label: "開始" })}〜{inp(r, "end", { label: "終了" })}</span> : `${r.v.start}〜${r.v.end}`}
                </td>
                <td>
                  {m === "other" ? <span className={s.note}>他院（参照のみ）</span> : m === "ended" ? <span className={s.note}>終了済</span> : null}
                  {m !== "other" && m !== "ended" && (
                    <span className={s.row}>
                      {full ? inp(r, "validFrom", { cls: s.date, ph: "YYYY/MM/DD", label: "開始日" }) : r.v.validFrom}〜
                      {m === "effect" || full ? inp(r, "validTo", { cls: s.date, ph: full ? "（無期限）" : "終了日", label: "終了日" }) : r.v.validTo || "（無期限）"}
                    </span>
                  )}
                  {m === "other" && <div className={s.note}>{r.v.validFrom}〜{r.v.validTo}</div>}
                  {errs.map((e, i) => <FieldError key={i} id={`e-${r.key}-${i}`} message={msg(e)} />)}
                </td>
                <td>{delOk && <button type="button" className={s.del} onClick={() => dropRow(r)}>削除</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // ── 例外 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const setKind = (kind: ExcKind) =>
    setForm((f) => ({
      ...f, kind, band: kind === "OFF" || f.band !== "ALL" ? f.band : "",
      departmentId: kind === "OFF" ? "" : f.departmentId, start: kind === "EXTRA" ? f.start : "", end: kind === "EXTRA" ? f.end : "",
      substituteDoctorId: kind === "SUBSTITUTE" ? f.substituteDoctorId : "",
    }));
  // event 10: the checks of rows 13-23, then hold; the hours of the date come from 抽出5
  async function hold() {
    const v: ExceptionValues = { ...form, date: iso(form.date) };
    let bands: NonNullable<Answer["bands"]> = [];
    if (v.kind === "EXTRA" && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) {
      const r = await call(`${URL.hours}?date=${v.date}`);
      if (!r?.ok) return;
      bands = r.json.bands ?? [];
    }
    const list = validateException(v, {
      today, hours: (_d, band) => { const b = bands.find((x) => x.band === band); return b ? { open: b.open, close: b.close } : null; },
    });
    setErrors((prev) => [...prev.filter((e) => !e.field.startsWith("x.")), ...list]);
    if (list.length > 0) return;
    setAdds((a) => [...a, { ...v, key: `x${++seq}` }]);
    setForm(blankForm());
  }
  // event 3 on the exception form: the field's own checks; SE042 needs the date's hours (抽出5), so it waits for 追加 (質疑)
  const blurX = (field: string) => {
    const list = validateException({ ...form, date: iso(form.date) }, { today, hours: () => ({ open: "00:00", close: "24:00" }) }).filter((x) => x.field === `x.${field}`);
    setErrors((prev) => [...prev.filter((x) => x.field !== `x.${field}`), ...list]);
  };
  const exceptionRows = () => {
    const stored = (detail?.exceptions ?? []).filter((x) => !removedExc.includes(x.id)).map((x: ExceptionRow) => ({ key: x.id, held: false, x }));
    const clinic = detail?.choices.clinicName ?? "";
    const held = adds.map((a) => ({
      key: a.key, held: true,
      x: {
        id: a.key, date: a.date, kind: a.kind as ExcKind, band: a.band === "ALL" || a.band === "" ? null : a.band, departmentId: a.departmentId || null,
        clinicName: a.kind === "OFF" ? null : clinic, departmentName: detail?.choices.departments.find((d) => d.id === a.departmentId)?.name ?? null,
        start: a.start || null, end: a.end || null, substituteName: detail?.choices.substitutes.find((d) => d.id === a.substituteDoctorId)?.name ?? null, note: a.note || null,
      } as ExceptionRow,
    }));
    return [...held, ...stored].sort((p, q) => {
      const pf = p.x.date >= today;
      const qf = q.x.date >= today;
      return pf !== qf ? (pf ? -1 : 1) : pf ? p.x.date.localeCompare(q.x.date) : q.x.date.localeCompare(p.x.date);
    });
  };
  const dropException = (r: { key: string; held: boolean }) => (r.held ? setAdds((a) => a.filter((x) => x.key !== r.key)) : setRemovedExc((x) => [...x, r.key]));

  function renderExceptions() {
    const list = exceptionRows();
    const k = form.kind;
    const f = (field: string) => `a02-x-${field}`;
    return (
      <>
        <table className={s.table}>
          <thead><tr><th>日付</th><th>種別</th><th>時間帯</th><th>クリニック・診療科</th><th>時間</th><th>代診医</th><th>メモ</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key}>
                <td>{dateLabel(iso(r.x.date))}{r.held && <div className={s.nsv}>未保存</div>}</td>
                <td><span className={`${s.badge} ${KIND_CLASS[r.x.kind]}`}>{EXC_LABEL[r.x.kind]}</span></td>
                <td>{r.x.band ? BAND_LABEL[r.x.band] : "終日"}</td>
                <td>{r.x.clinicName ? `${r.x.clinicName}・${r.x.departmentName ?? ""}` : ""}</td>
                <td>{r.x.start && r.x.end ? `${r.x.start}〜${r.x.end}` : ""}</td>
                <td>{r.x.substituteName ?? ""}</td>
                <td>{r.x.note ?? ""}</td>
                <td>{admin && (r.held || iso(r.x.date) >= today) && <button type="button" className={s.del} onClick={() => dropException(r)}>削除</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {admin && (
          <div className={s.form}>
            <div>
              <label htmlFor={f("date")}>日付 <RequiredMark lang="ja" /></label>
              <input id={f("date")} className="inp" placeholder="YYYY/MM/DD" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} onBlur={() => blurX("date")} aria-invalid={err("x.date") ? true : undefined} />
              <FieldError id="e-x-date" message={err("x.date")} />
            </div>
            <div>
              <label>種別 <RequiredMark lang="ja" /></label>
              <span className={s.radios} role="radiogroup" aria-label="種別">
                {(["OFF", "EXTRA", "SUBSTITUTE"] as const).map((x) => (
                  <label key={x}><input type="radio" name="a02-kind" checked={k === x} onChange={() => setKind(x)} />{EXC_LABEL[x]}</label>
                ))}
              </span>
              <FieldError id="e-x-kind" message={err("x.kind")} />
            </div>
            <div>
              <label htmlFor={f("band")}>時間帯</label>
              <select id={f("band")} className="inp" disabled={k === ""} value={form.band} onChange={(e) => setForm({ ...form, band: e.target.value as ExceptionValues["band"] })} onBlur={() => blurX("band")}>
                <option value="">選択してください</option>
                {k === "OFF" && <option value="ALL">終日</option>}
                <option value="AM">午前</option>
                <option value="PM">午後</option>
              </select>
              <FieldError id="e-x-band" message={err("x.band")} />
            </div>
            <div>
              <label htmlFor={f("departmentId")}>クリニック・診療科</label>
              <select id={f("departmentId")} className="inp" disabled={k !== "EXTRA" && k !== "SUBSTITUTE"} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} onBlur={() => blurX("departmentId")}>
                <option value="">選択してください</option>
                {detail?.choices.departments.map((d) => <option key={d.id} value={d.id}>{detail.choices.clinicName}・{d.name}</option>)}
              </select>
              <FieldError id="e-x-departmentId" message={err("x.departmentId")} />
            </div>
            <div>
              <label>開始〜終了</label>
              <span className={s.row}>
                <input id={f("start")} className={`inp ${s.time}`} aria-label="開始" disabled={k !== "EXTRA"} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} onBlur={() => blurX("start")} />〜
                <input id={f("end")} className={`inp ${s.time}`} aria-label="終了" disabled={k !== "EXTRA"} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} onBlur={() => blurX("end")} />
              </span>
              <FieldError id="e-x-start" message={err("x.start")} />
              <FieldError id="e-x-end" message={err("x.end")} />
            </div>
            <div>
              <label htmlFor={f("substituteDoctorId")}>代診医</label>
              <select id={f("substituteDoctorId")} className="inp" disabled={k !== "SUBSTITUTE"} value={form.substituteDoctorId} onChange={(e) => setForm({ ...form, substituteDoctorId: e.target.value })} onBlur={() => blurX("substituteDoctorId")}>
                <option value="">{k === "SUBSTITUTE" ? "選択してください" : "—"}</option>
                {detail?.choices.substitutes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <FieldError id="e-x-substituteDoctorId" message={err("x.substituteDoctorId")} />
            </div>
            <div>
              <label htmlFor={f("note")}>メモ</label>
              <input id={f("note")} className="inp" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} onBlur={() => blurX("note")} />
              <FieldError id="e-x-note" message={err("x.note")} />
            </div>
            <div><label>&nbsp;</label><Button variant="secondary" onClick={() => void hold()}>追加</Button></div>
          </div>
        )}
      </>
    );
  }

  // ── 保存する (events 4-6) ───────────────────────────────────────────────────────────────────────────────────────
  const body = () => ({
    doctorId,
    patterns: rows.filter(changed).map((r) => ({ key: r.key, delete: r.removed, ...wire(r.v) })),
    exceptionsAdd: adds.map((a) => ({ date: a.date, kind: a.kind, band: a.band, departmentId: a.departmentId, start: a.start, end: a.end, substituteDoctorId: a.substituteDoctorId, note: a.note })),
    exceptionsDelete: removedExc,
  });
  function show(list: FieldErr[]) {
    if (list.some((e) => e.code === "SE043")) setBanner(t("SE043", "ja"));
    setErrors(list);
    const first = list[0]?.field;
    if (first?.startsWith("p.")) setTimeout(() => document.getElementById(`a02-p-${first.split(".")[1]}-${first.split(".")[2]}`)?.focus(), 0);
  }
  async function save() {
    setErrors([]);
    setBanner(null);
    const local = rows.filter((r) => !r.removed && changed(r)).flatMap(rowChecks);
    if (local.length > 0) return show(local);
    setBusy(true);
    try {
      const r = await call(...postJson(URL.check, body()));
      if (!r) return;
      if (!r.ok) return r.json.errors ? show(r.json.errors) : setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
      if ((r.json.n ?? 0) > 0) setSw041(r.json.n ?? 0);
      else await commit();
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    const r = await call(...postJson(URL.save, body()));
    setSw041(null);
    if (!r) return;
    if (r.ok) toast("SI040", { params: r.json.params });
    else if (r.status === 409) setBanner(t("SE044", "ja"));
    else return r.json.errors ? show(r.json.errors) : setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
    // saved (SI040) or SE044: the saved rows stay, the held values are cleared (6-1, 6-2)
    const d = await call(`${URL.detail}?doctorId=${doctorId}`);
    const banner409 = r.status === 409;
    reset(d?.json.detail ?? detail);
    if (banner409) setBanner(t("SE044", "ja"));
    await loadWeek(week.start);
  }

  const summary = errors.map((e) => ({ fieldId: `a02-${e.field.replace(/\./g, "-")}`, message: msg(e) }));
  const doctor = doctors.find((d) => d.id === doctorId);

  return (
    <div className={s.root}>
      <div className={s.top}>
        <h1 className={s.h1}>医師シフト</h1>
      </div>
      {banner && <div className="err" role="alert" style={{ marginBottom: 12 }}><Icon name="alert" /> {banner}</div>}
      <ErrorSummary errors={summary} lang="ja" />
      <div className={s.layout}>
        <div className={s.panel}>
          <h2>医師 <RequiredMark lang="ja" /></h2>
          <div className={s.help}>この院の診療科を持つ有効な医師。</div>
          <div className={s.docs} role="listbox" aria-label="医師" onKeyDown={onDocKey}>
            {doctors.map((d) => (
              <button
                key={d.id} id={`a02-doc-${d.id}`} type="button" role="option" aria-selected={d.id === doctorId} tabIndex={d.id === doctorId ? 0 : -1}
                className={`${s.doc} ${d.id === doctorId ? s.docOn : ""}`} onClick={() => void pick(d.id)}
              >
                {d.name}<small>{d.sub}</small>
              </button>
            ))}
          </div>
        </div>
        <div>
          {detail && doctor && (
            <>
              <div className={`${s.panel} ${s.patterns}`}>
                <h2>
                  <span>定型シフト — {doctor.name}</span>
                </h2>
                {renderPatterns()}
                {/* after the rows in the DOM: Tab 11 (item 9-1); drawn top right of the panel */}
                {admin && <Button variant="secondary" className={`btn-sm ${s.addRow}`} onClick={addRow}>＋ 行追加</Button>}
                <div className={s.help}>適用中の行は削除できず、終了日（今日以降）を入れて終了。削除は開始日が未来の行のみ。他院のシフトは斜線で表示（重複チェック用）。</div>
              </div>
              <div className={s.panel}>
                <h2>例外（休み・追加勤務・代診）</h2>
                {renderExceptions()}
              </div>
            </>
          )}
          <div className={s.panel}>
            <h2>
              <span>週表示（{detail?.choices.clinicName ?? ""}・保存後の枠）<span className={s.badge}>閲覧のみ</span></span>
              <span className={s.row}>
                <Button variant="secondary" className="btn-sm" aria-label="前週" onClick={() => void loadWeek(addDaysIso(week.start, -7))}>‹</Button>
                <span>{short(week.days[0])} 〜 {short(week.days[6])}</span>
                <Button variant="secondary" className="btn-sm" aria-label="翌週" onClick={() => void loadWeek(addDaysIso(week.start, 7))}>›</Button>
              </span>
            </h2>
            <table className={s.table}>
              <thead>
                <tr><th>医師</th>{week.days.map((d) => <th key={d} className={wdOf(d) === 0 ? s.sun : wdOf(d) === 6 ? s.sat : ""}>{short(d)}</th>)}</tr>
              </thead>
              <tbody>
                {week.rows.map((r) => (
                  <tr key={r.doctorId}><td>{r.name}</td>{r.cells.map((c, i) => <td key={i} className={s.cell}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {admin && (
            <div className={s.bar}>
              <span className="mut xs">保存すると対象日の枠を再生成します。</span>
              <Button busy={busy} disabled={!dirty} onClick={() => void save()}>保存する</Button>
            </div>
          )}
        </div>
      </div>
      {/* last in the DOM: Tab 25 (item 20); drawn top right by .warn */}
      {role !== "DOCTOR" && adjust > 0 && <Link className={s.warn} href="/staff/ledger?filter=adjust"><Icon name="alert" size={16} /> 要調整の予約 {adjust}件 →</Link>}
      <ConfirmDialog open={sw041 !== null} title="予約がある枠が閉じます" messageId="SW041" params={{ n: sw041 ?? 0 }} onConfirm={commit} onCancel={() => setSw041(null)} />
    </div>
  );
}
