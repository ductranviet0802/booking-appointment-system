"use client";

// spec-screen: S02
// 代理予約. States: 基 (search only, areas 4–7 off) / ① patient selected / ② new patient form / ③ change mode / ④ ⑤ grid loading, empty / ⑥ search re-opened.
// Nothing is written before 予約を確定する (event 10); SW020 / SW021 are answered by the server before anything is committed.
import { useEffect, useMemo, useRef, useState } from "react";
import { postcodeOutcome } from "@/components/patient/PersonFields";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DateField, isoToText, parseDateText } from "@/components/ui/DatePicker";
import { ErrorSummary, FieldError, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { PREFECTURES, digitsOnly } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { todayJst } from "@/lib/datetime";
import { t } from "@/lib/i18n";
import { formatDateShort, formatTime } from "@/lib/i18n/format";
import { W3, w3 } from "@/lib/i18n/labels-w3";
import { checkBookingFields, checkNewPatient, checkSearch, type FErr } from "@/lib/staff/proxy-rules";
import type { Options, PatientSummary, Preset } from "@/lib/staff/proxy";
import s from "./booking.module.css";

type Answer = { code?: string; params?: Record<string, string | number>; errors?: FErr[] } & Record<string, unknown>;
type Row = { id: string; name: string; kana: string; birth: string; phone: string; card: string; web: boolean };
type Pick = { doctorId: string; label: string; start: string; end: string };

const URL = (a: string) => `/api/staff/booking/${a}`;
const BLANK_FORM: Record<string, unknown> = {
  nameType: "JP", familyName: "", givenName: "", familyNameKana: "", givenNameKana: "", birthDate: "", sex: "", postcode: "", prefecture: "",
  city: "", town: "", addressLine: "", building: "", phone: "", smsOptIn: false, cardNo: "",
};
const NO_OPTIONS: Options = { visitTypes: [], doctors: [], doctorId: "", grid: null, notice: null };
const msg = (e: FErr) => t(e.code, "ja", e.params);

export function ProxyClient({ preset }: { preset: Preset }) {
  const api = useApiFetch();
  const change = preset.change;
  const [patient, setPatient] = useState<PatientSummary | null>(preset.patient);
  const [searching, setSearching] = useState(false); // ⑥ : area 2 shown above the summary
  const [mode, setMode] = useState<"search" | "form">("search");
  const [q, setQ] = useState({ kana: "", phone: "", card: "", bookingNo: "" });
  const [rows, setRows] = useState<{ rows: Row[]; more: boolean } | null>(null);
  const [rowCursor, setRowCursor] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(BLANK_FORM);
  const [towns, setTowns] = useState<string[] | null>(null);
  const [postNote, setPostNote] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState(change?.departmentId ?? "");
  const [visitTypeId, setVisitTypeId] = useState(change?.visitTypeId ?? "");
  const [doctorSel, setDoctorSel] = useState(change?.doctorId ?? "");
  const [dateText, setDateText] = useState(isoToText(preset.date));
  const [channel, setChannel] = useState<string>(change?.channel ?? "");
  const [notes, setNotes] = useState(change?.notes ?? "");
  const [options, setOptions] = useState<Options>(NO_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [cursor, setCursor] = useState({ r: 0, c: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { id: "SW020" | "SW021"; nos?: string[] }>(null);
  const [busy, setBusy] = useState(false);
  const flags = useRef({ override: false, ack: false });

  const date = parseDateText(dateText);
  const formCheck = useMemo(() => checkNewPatient(form), [form]);
  const formOk = mode === "form" && !formCheck.tampered && formCheck.errors.filter((e) => e.field !== "cardNo").length === 0;
  const enabled = !!change || !!patient || formOk;
  const type = options.visitTypes.find((v) => v.id === visitTypeId);

  async function call(url: string, body: unknown) {
    const res = await api(...postJson(url, body));
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Answer };
  }
  const setErr = (e: FErr[]) => setErrors(Object.fromEntries(e.map((x) => [x.field, msg(x)])));
  const clearErr = (f: string) => setErrors((p) => ({ ...p, [f]: "" }));

  // events 1 / 6: lists and grid for department × date × doctor; a change drops the picked frame
  useEffect(() => {
    setPick(null);
    if (!enabled || !departmentId) { setOptions(NO_OPTIONS); return; }
    if (!date) { setOptions((o) => ({ ...o, grid: null, notice: null })); return; }
    let live = true;
    setLoading(true);
    void call(URL("options"), { departmentId, date, doctorId: doctorSel, bookingId: change?.bookingId }).then((r) => {
      if (!live || !r) return;
      setLoading(false);
      if (!r.ok) return r.json.code === "SE002" ? setErrors((p) => ({ ...p, date: t("SE002", "ja", r.json.params) })) : undefined;
      const o = r.json.options as Options;
      setOptions(o);
      setErrors((p) => ({ ...p, date: "" }));
      if (o.doctorId !== doctorSel && doctorSel) setDoctorSel(o.doctorId); // Q4 d
    });
    return () => { live = false; };
  }, [enabled, departmentId, date, doctorSel, visitTypeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── patient area ───────────────────────────────────────────────────────────────────────────────────────────────────
  async function search() {
    setInfo(null);
    const c = checkSearch(q);
    setErr(c.errors);
    if (c.errors.length) return;
    const r = await call(URL("search"), q);
    if (!r) return;
    if (!r.ok) return r.json.errors ? setErr(r.json.errors) : setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
    const list = r.json as unknown as { rows: Row[]; more: boolean };
    setRows(list);
    setRowCursor(0);
    setInfo(list.rows.length === 0 ? t("SI035", "ja") : list.more ? t("SI034", "ja") : null);
  }
  async function choose(row: Row) {
    const r = await call(URL("select"), { patientId: row.id });
    if (!r?.ok) return;
    setPatient(r.json.patient as PatientSummary);
    setSearching(false);
    setMode("search");
  }
  const rowKeys = (e: React.KeyboardEvent) => {
    if (!rows?.rows.length) return;
    if (e.key === "ArrowDown") setRowCursor(Math.min(rowCursor + 1, rows.rows.length - 1));
    else if (e.key === "ArrowUp") setRowCursor(Math.max(rowCursor - 1, 0));
    else if (e.key === "Enter") void choose(rows.rows[rowCursor]);
    else return;
    e.preventDefault();
  };

  const setF = (patch: Record<string, unknown>) => setForm((f) => ({ ...f, ...patch }));
  function blurF(...fields: string[]) {
    const c = checkNewPatient(form, new Date(), fields);
    if (c.tampered) return;
    setErrors((p) => ({ ...p, ...Object.fromEntries(fields.map((f) => [f, ""])), ...Object.fromEntries(c.errors.map((e) => [e.field, msg(e)])) }));
  }
  async function lookup() {
    blurF("postcode");
    const code = digitsOnly(form.postcode);
    if (!/^\d{7}$/.test(code)) return;
    setPostNote(null);
    try {
      const res = await fetch(`/api/postcode?code=${code}`);
      const out = postcodeOutcome(res.status, res.ok ? ((await res.json()) as { candidates: Array<{ prefecture: string; city: string; town: string }> }).candidates : []);
      if (out.patch) setF(out.patch);
      setTowns(out.towns);
      setPostNote(out.note === "PE012" ? "SE012" : out.note === "PE013" ? "SE013" : null);
    } catch {
      setPostNote("SE013");
    }
  }

  // ── event 7 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  function choosePick(colIdx: number, start: string) {
    const col = options.grid?.columns[colIdx];
    if (!col) return;
    if (!type) return setErrors((p) => ({ ...p, visitTypeId: t("SE001", "ja", { 項目: W3.visit }) }));
    const cells = col.cells.slice().sort((x, y) => x.start.localeCompare(y.start));
    const from = cells.findIndex((c) => c.start === start);
    const run = from < 0 ? [] : cells.slice(from, from + type.frames);
    const ok = run.length === type.frames && run.every((c, i) => c.state === "free" && (i === 0 || run[i - 1].end === c.start));
    if (!ok) return setBanner(t("SE020", "ja")); // the earlier selection stays
    setBanner(null);
    clearErr("frame");
    setPick({ doctorId: col.id, label: col.label, start, end: run[run.length - 1].end });
  }
  const picked = (colId: string, start: string) => !!pick && pick.doctorId === colId && start >= pick.start && start < pick.end;
  const gridKeys = (e: React.KeyboardEvent) => {
    const g = options.grid;
    if (!g) return;
    const { r, c } = cursor;
    if (e.key === "ArrowDown") setCursor({ r: Math.min(r + 1, g.times.length - 1), c });
    else if (e.key === "ArrowUp") setCursor({ r: Math.max(r - 1, 0), c });
    else if (e.key === "ArrowRight") setCursor({ r, c: Math.min(c + 1, g.columns.length - 1) });
    else if (e.key === "ArrowLeft") setCursor({ r, c: Math.max(c - 1, 0) });
    else if (e.key === "Enter") choosePick(c, g.times[r]);
    else return;
    e.preventDefault();
  };

  // ── event 10 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const target = patient ? patient.target : formOk && form.smsOptIn === true ? W3.targets.SMS : W3.targets.NONE;

  async function submit() {
    setBanner(null);
    const body = {
      departmentId, visitTypeId, date: date ?? dateText, startTime: pick?.start ?? "", channel, notes, doctorSel, doctorId: pick?.doctorId ?? "",
      ...(change ? { bookingId: change.bookingId, version: change.version } : patient ? { patientId: patient.id } : { newPatient: form }),
      overrideLimit: flags.current.override, ackNoTarget: flags.current.ack,
    };
    const local: FErr[] = checkBookingFields(body);
    if (!change && !patient && !formOk) {
      const c = checkNewPatient(form);
      if (!c.tampered) local.push(...c.errors);
    }
    if (local.length) {
      setErr(local);
      flags.current = { override: false, ack: false };
      document.getElementById(`p-${local[0].field}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await call(URL("confirm"), body);
      if (!r) return;
      if (r.ok && r.json.dialog) return setDialog({ id: r.json.dialog as "SW020" | "SW021", nos: r.json.nos as string[] | undefined });
      flags.current = { override: false, ack: false };
      if (r.ok) {
        const no = r.json.bookingNo as string;
        return window.location.assign(`/staff/ledger?date=${r.json.date}&booking=${no}&flash=${r.json.changed ? "SI021" : "SI020"}`); // T080
      }
      if (r.json.errors) return setErr(r.json.errors);
      const code = r.json.code ?? "SE090";
      if (code === "SE030") setErrors((p) => ({ ...p, cardNo: t(code, "ja") }));
      else setBanner(t(code, "ja", r.json.params));
      if (code === "SE020") { setPick(null); setVisitTypeId((v) => v); await refreshGrid(); } // 10-4: the grid is read again
    } finally {
      setBusy(false);
    }
  }
  async function refreshGrid() {
    const r = await call(URL("options"), { departmentId, date, doctorId: doctorSel, bookingId: change?.bookingId });
    if (r?.ok) setOptions(r.json.options as Options);
  }

  const readback = [
    patient ? `${patient.name} 様` : mode === "form" && form.familyName ? `${form.familyName} ${form.givenName} 様` : "",
    date && pick ? `${formatDateShort(date, "ja")} ${formatTime(pick.start)}〜${formatTime(pick.end)}` : date ? formatDateShort(date, "ja") : "",
    [preset.departments.find((d) => d.id === departmentId)?.name, type?.name].filter(Boolean).join(" "),
    pick?.label ?? "",
  ].filter(Boolean).join("・");

  const text = (f: string, extra: Record<string, unknown> = {}) => (
    <input
      id={`p-${f}`} className="inp" value={String(form[f] ?? "")} aria-invalid={!!errors[f] || undefined} onChange={(e) => setF({ [f]: e.target.value })}
      onBlur={() => blurF(f)} {...extra}
    />
  );
  const field = (label: string, f: string, control: React.ReactNode, o: { req?: boolean; note?: string } = {}) => (
    <div className={s.f}>
      <div className={s.lab}><label htmlFor={`p-${f}`}>{label}</label>{o.req && <RequiredMark lang="ja" />}{o.note && <small>{o.note}</small>}</div>
      {control}
      <FieldError id={`e-${f}`} message={errors[f]} />
    </div>
  );
  const summary = Object.entries(errors).filter(([, m]) => m).map(([f, m]) => ({ fieldId: `p-${f}`, message: m }));
  const showSearch = !patient || searching;

  return (
    <>
      <div className={s.top}>
        <h1 className={s.h1}>{W3.proxy}</h1><span className={s.badge}>{change ? W3.badgeChange : W3.badgeNew}</span>
      </div>
      <ErrorSummary errors={summary} lang="ja" />
      {banner && <div className="err" role="alert"><Icon name="alert" /> {banner}</div>}
      <div className={s.split}>
        <div>
          <section className={s.card}>
            <h2>{W3.areaPatient}</h2>
            {change && <div className={s.change}>{w3(W3.changeTarget, { no: `${change.bookingNo.slice(0, 4)}-${change.bookingNo.slice(4)}`, date: formatDateShort(change.date, "ja"), start: formatTime(change.start), end: formatTime(change.end) })}</div>}
            {patient && (
              <div className={s.summary} data-testid="summary">
                <div>
                  <b>{patient.name} 様</b>
                  <small>{patient.kana}・{patient.birth.replace(/\//g, "/")}生（{patient.age}歳）{patient.card && `・診察券 ${patient.card}`}</small>
                </div>
                {!change && !searching && <button type="button" className="lnk-btn" onClick={() => setSearching(true)}>{W3.changeLink}</button>}
              </div>
            )}
            {!change && showSearch && (
              <>
                <div className={s.tabs} role="tablist">
                  <button type="button" role="tab" aria-selected={mode === "search"} className={mode === "search" ? s.on : ""} onClick={() => setMode("search")}>{W3.tabSearch}</button>
                  <button type="button" role="tab" aria-selected={mode === "form"} className={mode === "form" ? s.on : ""} onClick={() => setMode("form")}>{W3.tabNew}</button>
                </div>
                {mode === "search" ? (
                  <>
                    <div className={s.two}>
                      {field(W3.kana, "kana", <input id="p-kana" className="inp" value={q.kana} onChange={(e) => setQ({ ...q, kana: e.target.value })} />)}
                      {field(W3.tel, "phone", <input id="p-phone" className="inp" value={q.phone} inputMode="tel" onChange={(e) => setQ({ ...q, phone: e.target.value })} />)}
                      {field(W3.card, "card", <input id="p-card" className="inp" value={q.card} onChange={(e) => setQ({ ...q, card: e.target.value })} />)}
                      {field(W3.bno, "bookingNo", <input id="p-bookingNo" className="inp" value={q.bookingNo} onChange={(e) => setQ({ ...q, bookingNo: e.target.value })} />)}
                    </div>
                    {errors.search && <FieldError id="e-search" message={errors.search} />}
                    <div><Button variant="secondary" onClick={() => void search()}><Icon name="search" size={16} />{W3.search}</Button></div>
                    {info && <div className={s.info} role="status">{info}</div>}
                    {rows && rows.rows.length > 0 && (
                      <>
                        <div className="mut">{w3(W3.count, { n: rows.rows.length })}</div>
                        <div className={s.results} tabIndex={0} role="grid" aria-label={W3.areaPatient} onKeyDown={rowKeys}>
                          <table>
                            <thead><tr><th>{W3.colPName}</th><th>{W3.colBirth}</th><th>{W3.colTel}</th><th>{W3.colCard}</th><th /></tr></thead>
                            <tbody>
                              {rows.rows.map((r, i) => (
                                <tr key={r.id} className={i === rowCursor ? s.cur : ""} onClick={() => void choose(r)}>
                                  <td><b>{r.name}</b><div className="mut">{r.kana}</div></td><td>{r.birth}</td><td>{r.phone}</td><td>{r.card}</td>
                                  <td>{r.web && <span className={s.tag}>{W3.web}</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className={s.f}>
                    {field(W3.nameType, "nameType", (
                      <div className={s.checks} role="radiogroup" id="p-nameType" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) blurF("nameType"); }}>
                        {(["JP", "ROMAJI"] as const).map((k) => (
                          <label key={k}><input type="radio" name="nameType" checked={form.nameType === k} onChange={() => { setF({ nameType: k }); setTimeout(() => blurF("familyName", "givenName", "familyNameKana", "givenNameKana"), 0); }} />{k === "JP" ? W3.nameJp : W3.nameRomaji}</label>
                        ))}
                      </div>
                    ), { req: true })}
                    <div className={s.two}>
                      {field(W3.family, "familyName", text("familyName", { lang: form.nameType === "ROMAJI" ? "en" : undefined }), { req: true })}
                      {field(W3.given, "givenName", text("givenName"), { req: true })}
                      {field(W3.kanaFamily, "familyNameKana", text("familyNameKana"), { req: true })}
                      {field(W3.kanaGiven, "givenNameKana", text("givenNameKana"), { req: true })}
                    </div>
                    {field(W3.birth, "birthDate", (
                      <DateField
                        id="p-birthDate" value={String(form.birthDate)} lang="ja" ariaLabel={W3.birth} min="1900-01-01" max={todayJst()} invalid={!!errors.birthDate}
                        onChange={(v) => setF({ birthDate: v })} onBlur={() => blurF("birthDate")}
                      />
                    ), { req: true })}
                    {field(W3.sex, "sex", (
                      <div className={s.checks} role="radiogroup" id="p-sex" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) blurF("sex"); }}>
                        {([["1", W3.male], ["2", W3.female]] as const).map(([k, l]) => (
                          <label key={k}><input type="radio" name="sex" checked={form.sex === k} onChange={() => setF({ sex: k })} />{l}</label>
                        ))}
                      </div>
                    ), { req: true })}
                    {field(W3.postcode, "postcode", text("postcode", { inputMode: "numeric", maxLength: 8, onBlur: () => void lookup() }), { req: true })}
                    {postNote && <FieldError id="e-post" message={t(postNote, "ja")} />}
                    <div className={s.two}>
                      {field(W3.prefecture, "prefecture", (
                        <select id="p-prefecture" className={s.sel} value={String(form.prefecture)} onChange={(e) => setF({ prefecture: e.target.value })} onBlur={() => blurF("prefecture")}>
                          <option value="">{W3.pick}</option>
                          {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ), { req: true })}
                      {field(W3.city, "city", text("city"), { req: true })}
                      {field(W3.town, "town", towns ? (
                        <select
                          id="p-town" className={s.sel} value={String(form.town)}
                          onChange={(e) => { if (e.target.value === "__other") { setTowns(null); setF({ town: "" }); } else setF({ town: e.target.value }); }}
                        >
                          <option value="">{W3.pick}</option>
                          {towns.map((x) => <option key={x} value={x}>{x}</option>)}
                          <option value="__other">{W3.townOther}</option>
                        </select>
                      ) : text("town"))}
                      {field(W3.line, "addressLine", text("addressLine"), { req: true })}
                    </div>
                    {field(W3.building, "building", text("building", { placeholder: W3.buildingPh }))}
                    {field(W3.tel, "phone", text("phone", { inputMode: "tel" }), { req: true })}
                    <label className={s.checks}>
                      <input id="p-smsOptIn" type="checkbox" checked={form.smsOptIn === true} onChange={(e) => setF({ smsOptIn: e.target.checked })} />{W3.sms}
                    </label>
                    {field(W3.card, "cardNo", text("cardNo"), { note: W3.cardOpt })}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <fieldset disabled={!enabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <section className={s.card}>
            <h2>{W3.areaCond}</h2>
            <div className={s.three}>
              {field(W3.dept, "departmentId", (
                <select
                  id="p-departmentId" className={s.sel} value={departmentId} disabled={!!change}
                  onChange={(e) => { setDepartmentId(e.target.value); setVisitTypeId(""); setDoctorSel(""); clearErr("departmentId"); }}
                >
                  <option value="">{W3.pick}</option>
                  {preset.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              ), { req: true })}
              {field(W3.visit, "visitTypeId", (
                <select id="p-visitTypeId" className={s.sel} value={visitTypeId} disabled={!!change} onChange={(e) => { setVisitTypeId(e.target.value); clearErr("visitTypeId"); }}>
                  <option value="">{W3.pick}</option>
                  {options.visitTypes.map((v) => <option key={v.id} value={v.id}>{`${v.name}（${v.minutes}分・${v.frames}枠）`}</option>)}
                </select>
              ), { req: true })}
              {field("医師", "doctorSel", (
                <select id="p-doctorSel" className={s.sel} value={doctorSel} onChange={(e) => setDoctorSel(e.target.value)}>
                  <option value="">{W3.noPref}</option>
                  {options.doctors.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              ), { req: true })}
            </div>
            <p className={s.note}>{W3.visitNote}</p>
          </section>

          <section className={s.card}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>{W3.areaFrame}</h2>
              <div className={s.f}>
                <div className={s.lab}><label htmlFor="p-date">{W3.frameDate}</label><RequiredMark lang="ja" /></div>
                <DateField id="p-date" value={dateText} lang="ja" ariaLabel={W3.frameDate} invalid={!!errors.date} disabled={!enabled} onChange={(v) => { setDateText(v); clearErr("date"); }} />
                <FieldError id="e-date" message={errors.date} />
              </div>
            </div>
            {options.notice && <div className="err" role="alert"><Icon name="alert" /> {t(options.notice.code, "ja", options.notice.params)}</div>}
            {loading && <div className="mut" role="status"><Icon name="spin" className="spin" size={14} /> …</div>}
            {options.grid && !loading && (
              <div className={s.grid} tabIndex={0} role="grid" aria-label={W3.areaFrame} onKeyDown={gridKeys}>
                <table>
                  <thead><tr><th />{options.grid.columns.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {options.grid.times.map((time, r) => (
                      <tr key={time}>
                        <th scope="row">{formatTime(time)}</th>
                        {options.grid!.columns.map((col, c) => {
                          const cell = col.cells.find((x) => x.start === time);
                          const on = picked(col.id, time);
                          const cls = `${s.cell} ${!cell || cell.state === "closed" ? s.none : cell.state === "full" ? s.full : ""} ${on ? s.pick : ""} ${cursor.r === r && cursor.c === c ? s.cur : ""}`;
                          return (
                            <td key={col.id}>
                              <button
                                type="button" tabIndex={-1} className={cls} disabled={!cell || cell.state !== "free"} aria-pressed={on} aria-label={`${col.label} ${formatTime(time)}`}
                                onClick={() => { setCursor({ r, c }); choosePick(c, time); }}
                              >
                                {on ? W3.selected : !cell || cell.state === "closed" ? "" : cell.state === "full" ? W3.full : W3.free}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FieldError id="e-frame" message={errors.frame} />
            <div className={s.legend}>{W3.legend}{pick && `（${type?.name ?? ""} ${type?.frames ?? ""}枠: ${pick.label} ${formatTime(pick.start)}〜${formatTime(pick.end)}）`}</div>
          </section>

          <section className={s.card}>
            <h2>{W3.areaInfo}</h2>
            <div className="row" style={{ gap: 32, alignItems: "flex-start" }}>
              {field(W3.chRoute, "channel", (
                <div className={s.checks} role="radiogroup" id="p-channel" tabIndex={-1}>
                  {([["PHONE", W3.phone], ["COUNTER", W3.counter]] as const).map(([k, l]) => (
                    <label key={k}><input type="radio" name="channel" checked={channel === k} onChange={() => { setChannel(k); clearErr("channel"); }} />{l}</label>
                  ))}
                </div>
              ), { req: true })}
              <div className={s.f}><div className={s.lab}>{W3.target}</div><div data-testid="target">{target}</div></div>
            </div>
            {field(W3.memo, "notes", (
              <textarea
                id="p-notes" className="inp" rows={3} value={notes} aria-invalid={!!errors.notes || undefined} onChange={(e) => setNotes(e.target.value)}
                onBlur={() => setErrors((p) => ({ ...p, notes: notes.length > 200 ? t("SE003", "ja", { 項目: W3.memo, n: 200 }) : "" }))}
              />
            ), { note: W3.optional })}
            <div className={s.counter}>{notes.length}/200</div>
          </section>
        </fieldset>
      </div>

      <div className={s.foot}>
        <a href={`/staff/ledger?date=${preset.date}`}>{W3.back}</a><span className="mut">{W3.backNote}</span>
        <span className="sp" />
        <span className={s.readback}>{readback}</span>
        <Button busy={busy} disabled={!enabled} onClick={() => void submit()}>{change ? W3.confirmChange : W3.confirm}</Button>
      </div>

      <ConfirmDialog
        open={dialog?.id === "SW020"} title={W3.dlg020Title} messageId="SW020" params={{ 予約番号: (dialog?.nos ?? []).map((n) => `${n.slice(0, 4)}-${n.slice(4)}`).join("、") }}
        onCancel={() => { flags.current = { override: false, ack: false }; setDialog(null); }}
        onConfirm={async () => { flags.current.override = true; setDialog(null); await submit(); }}
      />
      <ConfirmDialog
        open={dialog?.id === "SW021"} title={W3.dlg021Title} messageId="SW021"
        onCancel={() => { flags.current = { override: false, ack: false }; setDialog(null); }}
        onConfirm={async () => { flags.current.ack = true; setDialog(null); await submit(); }}
      />
    </>
  );
}
