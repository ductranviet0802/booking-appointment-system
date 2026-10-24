"use client";

// spec-screen: P11
// 予約入力: one page that grows downward (受診する方 → clinic → department → visit type → doctor → date → time); changing an
// earlier step clears the later ones (notes kept, Q24 A). Change mode (state ①): person / clinic / department / visit
// type read-only with the lock text. The calendar answer covers the whole window, so months, dates, 次の空き and the
// PI030 link are local.
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MonthGrid } from "@/components/ui/DatePicker";
import { ErrorSummary, FieldError } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { useFatal } from "@/components/patient/form";
import { postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import { formatDateShort, formatMonthHeading, formatPrice, formatTime } from "@/lib/i18n/format";
import { label } from "@/lib/i18n/labels";
import { lw1, type W1Key } from "@/lib/i18n/labels-w1";
import { formatPhone, telHref } from "@/lib/public/phone";
import type { Day, VisitTypeOption } from "@/lib/entry/data";
import type { EntryProps } from "@/lib/entry/pages";
import type { Selections } from "@/lib/booking/draft";
import { leaveTarget } from "./leave-target";
import { Steps } from "./Steps";
import { useLeaveGuard } from "./useLeaveGuard";
import s from "./entry.module.css";

type Opt = { id: string; name: string };
type Doc = { id: string; name: string; title: string };
type Cal = { min: string; max: string; days: Record<string, Day>; holidays: string[]; notes: Record<string, string> };
type FieldErr = { field: string; code: string; params?: Record<string, string | number> };

const MARK: Record<Day["mark"], [string, W1Key]> = { free: ["○", "legendFree"], few: ["△", "legendFew"], full: ["×", "legendFull"], closed: ["—", "legendClosed"] };
const ITEM: Record<string, W1Key> = { person: "person", clinic: "clinic", department: "department", visitType: "visitType", doctor: "doctor", notes: "notes", datetime: "dateTime" };
const monthOf = (iso: string) => iso.slice(0, 7);
const shift = (ym: string, d: number) => {
  const x = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + d, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function BookingEntry(p: EntryProps) {
  const { lang, change } = p;
  const apiFetch = useApiFetch();
  const fatal = useFatal();
  const [sel, setSel] = useState<Selections>(p.initial);
  const [touched, setTouched] = useState(p.touched);
  const [depts, setDepts] = useState<Opt[] | null>(null);
  const [types, setTypes] = useState<VisitTypeOption[] | null>(null);
  const [doctors, setDoctors] = useState<Doc[] | null>(null);
  const [cal, setCal] = useState<Cal | null>(null);
  const [calKey, setCalKey] = useState(0);
  const [month, setMonth] = useState<string | null>(null);
  const [error, setError] = useState(p.error);
  const [fields, setFields] = useState<FieldErr[]>([]);
  const [lost, setLost] = useState(p.lostStart);
  const [busy, setBusy] = useState(false);
  const [quit, setQuit] = useState(false);
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const [presetDoctor, setPresetDoctor] = useState(p.presetDoctorId);
  const [noNext, setNoNext] = useState(false);

  const base = { clinic: sel.clinicId ?? "", department: sel.departmentId ?? "", ...(change && { change: change.bookingId }) };
  async function get<T>(params: Record<string, string>): Promise<T | null> {
    const res = await apiFetch(`/api/booking/options?${new URLSearchParams(params)}`);
    if (!res) return null;
    if (res.status === 404) {
      const body = await res.json().catch(() => ({}));
      if (body.to) return window.location.assign(body.to), null; // A-1: another account's person / booking → ER-01
    }
    if (!res.ok) return fatal(), null;
    return res.json();
  }

  // event 2: departments of the clinic
  useEffect(() => {
    if (!sel.clinicId) return;
    let alive = true;
    get<{ departments: Opt[] }>({ step: "departments", clinic: sel.clinicId }).then((r) => alive && r && setDepts(r.departments));
    return () => { alive = false; };
  }, [sel.clinicId]); // eslint-disable-line react-hooks/exhaustive-deps

  // event 3: visit types, 初診 / 再診 pre-selection for the person (logged in only, 抽出5)
  useEffect(() => {
    if (!sel.clinicId || !sel.departmentId) return;
    let alive = true;
    get<{ types: VisitTypeOption[]; preselect: string | null }>({ step: "types", ...base, ...(p.loggedIn && sel.patientId && { patient: sel.patientId }) }).then((r) => {
      if (!alive || !r) return;
      setTypes(r.types);
      if (r.preselect) setSel((x) => (x.visitTypeId ? x : { ...x, visitTypeId: r.preselect }));
    });
    return () => { alive = false; };
  }, [sel.clinicId, sel.departmentId, sel.patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // event 4: doctors; the T040 doctor applied when listed (Q27 A), a doctor no longer listed → 指名なし
  useEffect(() => {
    if (!sel.visitTypeId) return;
    let alive = true;
    get<{ doctors: Doc[] }>({ step: "doctors", ...base, visitType: sel.visitTypeId }).then((r) => {
      if (!alive || !r) return;
      setDoctors(r.doctors);
      const listed = (id: string | null) => !!id && r.doctors.some((d) => d.id === id);
      setSel((x) => ({ ...x, doctorId: listed(presetDoctor) ? presetDoctor : listed(x.doctorId) ? x.doctorId : null }));
      setPresetDoctor(null);
    });
    return () => { alive = false; };
  }, [sel.visitTypeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // event 5: the calendar over the window; opens on the first free date, selected (F4-03, Q11 A)
  useEffect(() => {
    if (!sel.visitTypeId || doctors === null) return;
    let alive = true;
    setCal(null);
    get<Cal>({ step: "calendar", ...base, visitType: sel.visitTypeId, doctor: sel.doctorId ?? "" }).then((r) => {
      if (!alive || !r) return;
      setCal(r);
      const first = Object.keys(r.days).sort().find((d) => r.days[d].starts.length > 0) ?? null;
      setSel((x) => {
        const date = x.date && x.date >= r.min && x.date <= r.max ? x.date : first;
        setMonth(monthOf(date ?? r.min));
        return date === x.date ? x : { ...x, date, start: null };
      });
    });
    return () => { alive = false; };
  }, [sel.visitTypeId, sel.doctorId, doctors, calKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const type = types?.find((v) => v.id === sel.visitTypeId) ?? null;
  const firstNew = !change && type?.category === "FIRST";
  const hasFamily = p.loggedIn && !change && p.persons.length > 1;
  const day = sel.date && cal ? cal.days[sel.date] : undefined;
  const starts = day?.starts ?? [];
  const nextFreeAfter = (from: string) => (cal ? Object.keys(cal.days).sort().find((d) => d > from && cal.days[d].starts.length > 0) ?? null : null);
  const anyFree = !!cal && Object.values(cal.days).some((d) => d.starts.length > 0);
  const clinic = p.clinics.find((c) => c.id === sel.clinicId);

  /** a user choice: later steps cleared by the caller; messages of the last attempt go */
  function choose(next: Partial<Selections>, clear: { depts?: boolean; types?: boolean; doctors?: boolean; cal?: boolean } = {}) {
    setTouched(true);
    setError(null);
    setFields([]);
    setLost(null);
    if (clear.depts) setDepts(null);
    if (clear.types) setTypes(null);
    if (clear.doctors) setDoctors(null);
    if (clear.cal) setCal(null);
    setSel((x) => ({ ...x, ...next }));
  }
  const after = { clinicId: null, departmentId: null, visitTypeId: null, doctorId: null, date: null, start: null };
  const pickDate = (date: string) => { choose({ date, start: null }); setMonth(monthOf(date)); };
  // 6-2 / 6-3 (Q12 A): select the next free date, else answer PI032
  const nextFree = () => {
    const target = nextFreeAfter(sel.date ?? `${month}-00`);
    setNoNext(!target);
    if (target) pickDate(target);
  };

  async function submit() {
    setBusy(true);
    setFields([]);
    const res = await apiFetch(...postJson("/api/booking/next", { sel, origin: p.origin, changeBookingId: change?.bookingId, version: change?.version }));
    if (!res) return setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (body.to) return window.location.assign(body.to);
    setBusy(false);
    if (res.status === 400 && body.code === "FIELDS") return setFields(body.errors);
    if (res.status !== 409) return fatal();
    // 11-2 … 11-7: message at the step concerned (Q4 A); PE030 / PE032 / PE035 de-select the time
    const at = body.rule === "WINDOW" ? "date" : body.rule === "LIMIT" || body.rule === "OVERLAP" ? "ops" : "time";
    setError({ code: body.code, params: body.params ?? {}, at });
    if (at === "time") {
      if (body.rule === "TAKEN") { setLost(sel.start); setCalKey((k) => k + 1); }
      setSel((x) => ({ ...x, start: null }));
    }
  }

  async function leave() {
    const res = await apiFetch(...postJson("/api/booking/discard", { origin: p.origin }));
    const body = res ? await res.json().catch(() => ({})) : {};
    window.location.assign(leaveTarget(linkTo, body.to, p.origin));
  }
  // Q-039 answer: a header link asks PW005 when something is chosen (Q20 A); はい → the link pressed
  useLeaveGuard(useCallback((href: string) => {
    if (!touched) return window.location.assign(href);
    setLinkTo(href);
    setQuit(true);
  }, [touched]));

  const msg = (at: string) => error?.at === at && (
    <div className="err" role="alert"><div className="row"><Icon name="alert" />{t(error.code, lang, error.params)}</div></div>
  );
  const fieldText = (e: FieldErr) => t(e.code, lang, { 項目: lw1(ITEM[e.field] ?? "notes", lang), field: lw1(ITEM[e.field] ?? "notes", lang), ...(e.params ?? {}) });
  const notesLen = [...sel.notes].length;
  const notesErr = notesLen > 200 ? t("PE003", lang, { 項目: lw1("notes", lang), field: lw1("notes", lang), n: 200 }) : null; // event 9
  const nextLabel: W1Key = !p.loggedIn ? "next" : firstNew ? "nextToQuestionnaire" : "nextToConfirm";
  const ready = (!hasFamily || !!sel.patientId) && !!sel.clinicId && !!sel.departmentId && !!sel.visitTypeId && doctors !== null && !!sel.date && !!sel.start;
  const pi030 = t("PI030", lang, { 日付: "\u0000" }).split("\u0000"); // item 19-1 text around the 19-2 link (event 14)
  const minMonth = cal ? monthOf(cal.min) : null;
  const maxMonth = cal ? monthOf(cal.max) : null;

  const radios = <T extends { id: string }>(name: string, list: T[], value: string | null, onPick: (id: string) => void, body: (x: T) => React.ReactNode, ariaKey: W1Key) => (
    <div className={s.cards} role="radiogroup" aria-label={lw1(ariaKey, lang)}>
      {list.map((x) => (
        <label key={x.id} className={`${s.opt} ${value === x.id ? s.on : ""}`}>
          <input type="radio" name={name} checked={value === x.id} onChange={() => onPick(x.id)} />
          <span className={s.optBody}>{body(x)}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className={s.root}>
      <div className={s.head}>
        <h1 className="m0">{lw1("entryHeading", lang)}</h1>
        <Steps lang={lang} withQuestionnaire={firstNew} current="select" />
      </div>
      {msg("top")}
      <ErrorSummary errors={fields.map((e) => ({ fieldId: `p11-${e.field}`, message: fieldText(e) }))} lang={lang} />

      <div className={s.cols}>
        <div className="col g16">
          {change && (
            <>
              <div className="info"><Icon name="cal" />{lw1("changeBefore", lang, { date: formatDateShort(change.date, lang), time: formatTime(change.start), no: `${change.bookingNo.slice(0, 4)}-${change.bookingNo.slice(4)}` })}</div>
              <section className={s.step}>
                <dl className={s.fixed}>
                  <dt>{lw1("person", lang)}</dt><dd>{change.patientName} <span className="badge">{lw1(`rel${change.relation}` as W1Key, lang)}</span></dd>
                  <dt>{lw1("clinic", lang)}</dt><dd>{change.clinicName}</dd>
                  <dt>{lw1("deptAndType", lang)}</dt><dd>{change.deptName} · {change.typeName}</dd>
                </dl>
                <p className="xs mut m0 row"><Icon name="lock" size={14} />{lw1("lockText", lang)}</p>
              </section>
            </>
          )}

          {hasFamily && (
            <section className={s.step} id="p11-person">
              <h2>{lw1("person", lang)}</h2>
              {radios("p11-person", p.persons, sel.patientId, (id) => choose({ ...after, patientId: id }, { depts: true, types: true, doctors: true, cal: true }),
                (x) => (<><span className={s.nm}>{x.name}</span> <span className="badge">{lw1(`rel${x.relation}` as W1Key, lang)}</span></>), "person")}
            </section>
          )}

          {!change && (
            <section className={s.step} id="p11-clinic">
              <h2><span className={s.no}>1</span>{lw1("clinic", lang)}</h2>
              {radios("p11-clinic", p.clinics, sel.clinicId, (id) => choose({ ...after, clinicId: id }, { depts: true, types: true, doctors: true, cal: true }), (x) => x.name, "clinic")}
            </section>
          )}

          {!change && sel.clinicId && (
            <section className={s.step} id="p11-department">
              <h2><span className={s.no}>2</span>{lw1("department", lang)}</h2>
              {depts ? radios("p11-department", depts, sel.departmentId, (id) => choose({ departmentId: id, visitTypeId: null, doctorId: null, date: null, start: null }, { types: true, doctors: true, cal: true }), (x) => x.name, "department") : <Skeleton style={{ height: 48 }} />}
            </section>
          )}

          {sel.departmentId && (
            <section className={s.step} id="p11-visitType">
              {!change && <h2><span className={s.no}>3</span>{lw1("visitType", lang)}</h2>}
              {types === null ? <Skeleton style={{ height: 48 }} /> : !change && radios("p11-visitType", types, sel.visitTypeId,
                (id) => choose({ visitTypeId: id, doctorId: null, date: null, start: null }, { doctors: true, cal: true }),
                (v) => (<>
                  <span className={s.nm}>{v.name}</span>
                  {v.category === "FIRST" && <span className="xs mut">{lw1("firstVisitSub", lang)}</span>}
                  {v.category === "SELF_PAY" && v.priceYen !== null && <span className="sm">{formatPrice(v.priceYen, lang)}{lw1("taxIncl", lang)}</span>}
                </>), "visitType")}
              {type && type.category !== "SELF_PAY" && <div className="info sm"><Icon name="alert" />{t("PI033", lang)}</div>}
              {type?.notice && <div className="warn sm"><div><b>{lw1("noticeHeading", lang)}</b><div className={s.pre}>{type.notice}</div></div></div>}
            </section>
          )}

          {sel.visitTypeId && (
            <section className={s.step} id="p11-doctor">
              <h2><span className={s.no}>{change ? "" : 4}</span>{lw1("doctor", lang)}</h2>
              {doctors === null ? <Skeleton style={{ height: 48 }} /> : (
                <>
                  {radios("p11-doctor", [{ id: "", name: label("noPreference", lang), title: "" }, ...doctors], sel.doctorId ?? "",
                    (id) => choose({ doctorId: id || null, date: null, start: null }, { cal: true }),
                    (d) => (<><span className={s.nm}>{d.name}</span>{d.title && <span className="xs mut">{d.title}</span>}</>), "doctor")}
                  {sel.doctorId === null && <p className="xs mut m0">{t("PI034", lang)}</p>}
                </>
              )}
            </section>
          )}
        </div>

        <div className="col g16">
          {sel.visitTypeId && doctors !== null && (
            <section className={s.step} id="p11-date" aria-busy={cal === null}>
              <h2><span className={s.no}>{change ? "" : 5}</span>{lw1("date", lang)}</h2>
              {msg("date")}
              {cal === null || month === null ? <Skeleton style={{ height: 280 }} /> : (
                <>
                  <div className={s.monthNav}>
                    <button type="button" className="btn bs btn-sm" disabled={month <= minMonth!} onClick={() => setMonth(shift(month, -1))}>‹ {label("calPrev", lang)}</button>
                    <b aria-live="polite">{formatMonthHeading(Number(month.slice(0, 4)), Number(month.slice(5, 7)), lang)}</b>
                    <button type="button" className="btn bs btn-sm" disabled={month >= maxMonth!} onClick={() => setMonth(shift(month, 1))}>{label("calNext", lang)} ›</button>
                  </div>
                  <div className={s.grid}>
                    <MonthGrid
                      month={month} lang={lang} selected={sel.date} min={cal.min} max={cal.max} ariaLabel={lw1("calendarAria", lang)}
                      onMonth={(m) => { if (m >= minMonth! && m <= maxMonth!) setMonth(m); }}
                      onPick={pickDate}
                      isDisabled={(iso) => (cal.days[iso]?.mark ?? "closed") === "closed"}
                      isHoliday={(iso) => cal.holidays.includes(iso)}
                      mark={(iso) => {
                        if (iso < cal.min || iso > cal.max) return null;
                        const [sym, key] = MARK[cal.days[iso]?.mark ?? "closed"];
                        return (<><span aria-hidden>{sym}</span><span className="sr-only">{lw1(key, lang)}</span></>);
                      }}
                    />
                  </div>
                  <p className={`xs mut m0 ${s.legend}`}>
                    {(Object.keys(MARK) as Day["mark"][]).map((k) => <span key={k}>{MARK[k][0]} {lw1(MARK[k][1], lang)}</span>)}
                  </p>
                  {anyFree ? (
                    <>
                      <button type="button" className="btn bs btn-sm" onClick={nextFree}>
                        <Icon name="cal" />{lw1("nextFree", lang)}
                      </button>
                      {noNext && (
                        <div className="info" role="status">
                          <div>{t("PI032", lang)} {clinic && <a className="lnk" href={telHref(clinic.phone)}>{formatPhone(clinic.phone)}</a>}</div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="info" role="status">
                      <div>{t("PI032", lang)} {clinic && <a className="lnk" href={telHref(clinic.phone)}>{formatPhone(clinic.phone)}</a>}</div>
                    </div>
                  )}
                  {(sel.date && cal.notes[sel.date]) && <p className="sm m0 row"><Icon name="alert" size={16} />{cal.notes[sel.date]}</p>}
                </>
              )}
            </section>
          )}

          {sel.date && cal && anyFree && (
            <section className={s.step} id="p11-time">
              <h2><span className={s.no}>{change ? "" : 6}</span>{lw1("time", lang)} <span className="sm mut">{formatDateShort(sel.date, lang)}</span></h2>
              {msg("time")}
              {starts.length === 0 ? (
                <div className="info" role="status">
                  {nextFreeAfter(sel.date) ? (
                    <span>{pi030[0]}
                      <button type="button" className={`lnk ${s.linkBtn}`} onClick={() => pickDate(nextFreeAfter(sel.date!)!)}>{formatDateShort(nextFreeAfter(sel.date)!, lang)}</button>
                      {pi030[1]}</span>
                  ) : (
                    <span>{t("PI032", lang)} {clinic && <a className="lnk" href={telHref(clinic.phone)}>{formatPhone(clinic.phone)}</a>}</span>
                  )}
                </div>
              ) : (
                <div role="radiogroup" aria-label={lw1("time", lang)} className="col g8">
                  {(["am", "pm"] as const).map((band) => {
                    const list = [...new Set([...starts, ...(lost && sel.date ? [lost] : [])])].sort().filter((x) => (band === "am" ? x < "12:00" : x >= "12:00"));
                    return list.length > 0 && (
                      <div key={band} className="col g4">
                        <span className="xs mut">{lw1(band, lang)}</span>
                        <div className={s.times}>
                          {list.map((x) => {
                            const gone = !starts.includes(x);
                            return (
                              <label key={x} className={`${s.time} ${sel.start === x ? s.on : ""} ${gone ? s.gone : ""}`}>
                                <input type="radio" name="p11-time" checked={sel.start === x} disabled={gone} onChange={() => choose({ start: x })} />
                                {formatTime(x)}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {sel.date && starts.length > 0 && (
            <section className={s.step}>
              <label className="lbl" htmlFor="p11-notes">{lw1("notes", lang)} <span className="opt">{lw1("optional", lang)}</span></label>
              <textarea
                id="p11-notes" className="inp" rows={3} value={sel.notes} placeholder={lw1("notesPlaceholder", lang)}
                aria-invalid={notesErr ? true : undefined} aria-describedby="p11-notes-err"
                onChange={(e) => { setTouched(true); setSel((x) => ({ ...x, notes: e.target.value })); }}
              />
              <span className="xs mut">{notesLen}/200</span>
              <FieldError id="p11-notes-err" message={notesErr} />
            </section>
          )}
        </div>
      </div>

      <div className="w1-bar">
        {msg("ops")}
        {sel.date && sel.start && <span className="sm row"><Icon name="clock" size={16} />{lw1("selectedAt", lang, { date: formatDateShort(sel.date, lang), time: formatTime(sel.start) })}</span>}
        <Button busy={busy} disabled={!ready} onClick={submit} id="p11-datetime">{lw1(nextLabel, lang)}</Button>
        <button type="button" className={`lnk lnk-btn ${s.quit}`} onClick={() => { setLinkTo(null); if (touched) setQuit(true); else leave(); }}>{lw1("quit", lang)}</button>
      </div>

      <ConfirmDialog open={quit} title={lw1("quitTitle", lang)} messageId="PW005" onConfirm={leave} onCancel={() => { setQuit(false); setLinkTo(null); }} />
    </div>
  );
}
