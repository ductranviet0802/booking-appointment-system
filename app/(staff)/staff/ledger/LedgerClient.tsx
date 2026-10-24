"use client";

// spec-screen: S01
// 予約台帳. States: 基 / ① other date / ② empty / ④ doctor view (no action items) / ⑤ 要調整 filter / ⑥ 候補 filter / ⑦ 競合 banner /
// ⑧ 取消 dialog / ⑨ 問診・備考 dialog. After every write the list is read again (Q14).
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, trapTab } from "@/components/ui/ConfirmDialog";
import { DateField, isoToText, parseDateText } from "@/components/ui/DatePicker";
import { FieldError } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { addDays } from "@/lib/datetime";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import { W3, w3 } from "@/lib/i18n/labels-w3";
import type { LedgerRow, LedgerView } from "@/lib/staff/ledger";
import { STATES, showNo, type DisplayState, type Filter } from "@/lib/staff/ledger-rules";
import s from "./ledger.module.css";

type Answer = { code?: string; params?: Record<string, string | number>; errors?: Array<{ field: string; code: string; params?: Record<string, string | number> }> } & Record<string, unknown>;
type Dialog = { heading: string; language: string | null; answers: Array<{ id: string; question: string; answer: string }>; notes: string | null };
type Query = { date: string; doctorId: string; states: DisplayState[]; filter: Filter | null };

const URLS = { list: "/api/staff/ledger/list", act: "/api/staff/ledger/act", search: "/api/staff/ledger/search", dialog: "/api/staff/ledger/dialog" };
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`;
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const mdw = (iso: string) => `${md(iso)}(${WD[new Date(`${iso}T00:00:00Z`).getUTCDay()]})`;

export function LedgerClient({ initial, flash }: { initial: LedgerView; flash: { id: string; params?: Record<string, string> } | null }) {
  const { toast } = useToast();
  const api = useApiFetch();
  const [view, setView] = useState(initial);
  const [dateText, setDateText] = useState(isoToText(initial.date));
  const [dateError, setDateError] = useState<string | null>(null);
  const [no, setNo] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [cancelRow, setCancelRow] = useState<LedgerRow | null>(null);
  const [form, setForm] = useState({ reason: "", text: "", channel: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<null | "cancel" | { kind: "noshow"; row: LedgerRow } | { kind: "adjust"; rows: LedgerRow[] }>(null);
  const [info, setInfo] = useState<Dialog | null>(null);
  const hlRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => { if (flash) toast(flash.id, { params: flash.params }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { hlRef.current?.scrollIntoView?.({ block: "center" }); }, [view.highlight, view.rows]);

  async function call(url: string, body: unknown) {
    const res = await api(...postJson(url, body));
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Answer };
  }
  const query = (over: Partial<Query> = {}): Query => ({ date: view.date, doctorId: view.doctorId, states: view.states, filter: view.filter, ...over });

  async function load(q: Query, highlight?: string) {
    const r = await call(URLS.list, { ...q, highlight });
    if (!r) return;
    if (!r.ok) return setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
    const next = r.json.view as LedgerView;
    setView(next);
    setDateText(isoToText(next.date));
    setDateError(null);
  }
  const reload = () => load(query());

  /** event 2: any change of the condition returns a 要調整 / 候補 filter to the date list (Q6) */
  const change = (over: Partial<Query>) => { setBanner(null); return load(query({ ...over, filter: null })); };
  const pickDate = (iso: string) => { setDateText(isoToText(iso)); void change({ date: iso }); };

  async function act(body: Record<string, unknown>, okToast: (j: Answer) => [string, Record<string, string | number>?]) {
    const r = await call(URLS.act, body);
    if (!r) return null;
    if (r.ok) {
      setBanner(null);
      toast(...okToast(r.json));
    } else if (r.json.errors) {
      setErrors(Object.fromEntries(r.json.errors.map((e) => [e.field, t(e.code, "ja", e.params)])));
      setConfirm(null);
      return r;
    } else {
      setBanner(t(r.json.code ?? "SE090", "ja", r.json.params)); // SE010 / SE011: red banner, list reloaded (⑦)
    }
    setCancelRow(null);
    setConfirm(null);
    await reload();
    return r;
  }

  const write = (row: LedgerRow, kind: "checkin" | "undo" | "noshow" | "correct") =>
    act({ kind, bookingId: row.id, version: row.version }, () =>
      kind === "checkin" ? ["SI010", { 氏名: row.name }] : [kind === "undo" ? "SI011" : kind === "noshow" ? "SI012" : "SI017"]);

  async function search() {
    const r = await call(URLS.search, { bookingNo: no });
    if (!r) return;
    if (!r.ok) return setBanner(t(r.json.code ?? "SE001", "ja", r.json.params));
    if (!r.json.found) return toast("SI018");
    setBanner(null);
    if (r.json.switched) return window.location.assign(`/staff/ledger?date=${r.json.date}&booking=${r.json.bookingNo}`);
    await load(query({ date: r.json.date as string, filter: null }), r.json.bookingNo as string);
  }

  async function openInfo(row: LedgerRow) {
    const r = await call(URLS.dialog, { bookingId: row.id });
    if (r?.ok) setInfo(r.json as unknown as Dialog);
  }

  function startCancel(row: LedgerRow) {
    setForm({ reason: "", text: "", channel: "" });
    setErrors({});
    setCancelRow(row);
  }
  function checkCancel() {
    const e: Record<string, string> = {};
    if (!form.reason) e.reason = t("SE001", "ja", { 項目: W3.field.reason });
    if (form.reason === "OTHER" && !form.text.trim()) e.reasonText = t("SE001", "ja", { 項目: W3.field.reasonText });
    if (!form.channel) e.channel = t("SE001", "ja", { 項目: W3.field.channel });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function menu(row: LedgerRow, v: string) {
    if (v === "change") window.location.assign(`/staff/booking?bookingId=${row.id}`);
    else if (v === "cancel") startCancel(row);
    else if (v === "noshow") setConfirm({ kind: "noshow", row });
    else if (v === "correct") void write(row, "correct");
    else if (v === "adjust") setConfirm({ kind: "adjust", rows: [row] });
  }

  const adjustMode = view.filter === "adjust";
  const dateMode = view.filter === null;
  const noArea = view.notices.candidates === 0 && view.notices.adjust === 0 && !view.batch;
  const unchecked = STATES.filter((x) => !view.states.includes(x)).map((x) => W3.states[x]);
  const label = view.date === view.today ? "本日" : md(view.date);

  const rowMenu = (r: LedgerRow) => {
    const items: Array<[string, string]> = [
      ...(r.can.change ? [["change", W3.change] as [string, string]] : []),
      ...(r.can.cancel ? [["cancel", W3.cancel] as [string, string]] : []),
      ...(r.can.noShow && view.filter !== "adjust" ? [["noshow", W3.noShow] as [string, string]] : []),
      ...(r.can.correct && view.filter !== "adjust" ? [["correct", W3.correct] as [string, string]] : []),
      ...(r.can.adjust && view.filter !== "candidate" && view.filter !== "candidate7" ? [["adjust", W3.adjust] as [string, string]] : []),
    ];
    return (
      <select className={s.menu} aria-label={W3.menu} value="" disabled={items.length === 0} onChange={(e) => menu(r, e.target.value)}>
        <option value="">{W3.menu}</option>
        {items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
  };

  return (
    <>
      <h1 className={s.h1}>{W3.ledger}</h1>
      <div className={s.bar}>
        <div>
          <DateField
            id="lg-date" value={dateText} lang="ja" ariaLabel={W3.date} invalid={!!dateError} describedBy="lg-date-e"
            onChange={(v) => { setDateText(v); const iso = parseDateText(v); if (iso) { setDateError(null); void change({ date: iso }); } }}
            onBlur={() => setDateError(dateText.trim() === "" ? t("SE001", "ja", { 項目: W3.field.date }) : null)}
          />
          <FieldError id="lg-date-e" message={dateError} />
        </div>
        <div className={s.seg}>
          <button type="button" onClick={() => pickDate(addDays(view.date, -1))}>{W3.prev}</button>
          <button type="button" className={view.date === view.today ? s.on : ""} onClick={() => pickDate(view.today)}>{W3.today}</button>
          <button type="button" onClick={() => pickDate(addDays(view.date, 1))}>{W3.next}</button>
        </div>
        <label className={s.pick}>{W3.doctorPrefix}
          <select value={view.doctorId} disabled={view.isDoctor} onChange={(e) => void change({ doctorId: e.target.value })}>
            {!view.isDoctor && <option value="">{W3.all}</option>}
            {view.doctors.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <input
          className={s.search} placeholder={W3.searchPh} aria-label={W3.searchPh} value={no} onChange={(e) => setNo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
        />
        <span className="sp" />
        {!view.isDoctor && <a className="btn bp" href={`/staff/booking?date=${view.date}`}><Icon name="plus" size={16} />{W3.newBooking}</a>}
      </div>
      <div className={s.states} role="group" aria-label={W3.statePrefix}>
        <span>{W3.statePrefix}</span>
        {STATES.map((st) => (
          <label key={st}>
            <input
              type="checkbox" checked={view.states.includes(st)}
              onChange={(e) => void change({ states: e.target.checked ? [...view.states, st] : view.states.filter((x) => x !== st) })}
            />
            {W3.states[st]}
          </label>
        ))}
      </div>

      {banner && <div className="err" role="alert"><Icon name="alert" /> {banner}</div>}
      {!noArea && (
        <div>
          {view.notices.candidates > 0 && (
            <div className={s.notice}>
              <Icon name="alert" />
              <button type="button" onClick={() => void load(query({ filter: "candidate" }))}>
                {t("SI013", "ja", { n: view.notices.candidates, m: view.notices.old })}
              </button>
              {view.notices.old > 0 && (
                <button type="button" onClick={() => void load(query({ filter: "candidate7" }))}>{w3(W3.candidateLink, { m: view.notices.old })}</button>
              )}
            </div>
          )}
          {view.notices.adjust > 0 && (
            <div className={s.notice}>
              <Icon name="cal" />
              <button type="button" onClick={() => void load(query({ filter: "adjust" }))}>{t("SI014", "ja", { n: view.notices.adjust })}</button>
            </div>
          )}
          {view.batch && <div className={s.batch}>{view.batch}</div>}
        </div>
      )}

      {dateMode ? (
        <div className={s.totals}>
          {(["RESERVED", "CHECKED_IN", "NO_SHOW", "CANCELED", "ADJUST"] as const).map((k) => <span key={k}>{W3.states[k]}<b>{k === "RESERVED" ? view.totals.RESERVED + view.totals.CANDIDATE : view.totals[k]}</b></span>)}
          <span className={s.sum}>
            {label} 計 {view.totals.all}件{unchecked.length > 0 && `（${unchecked.join("・")}を除く ${view.shown}件を表示）`}
          </span>
        </div>
      ) : adjustMode ? (
        <div className={s.heading}>
          <span>{w3(W3.adjustHeading, { n: view.shown })}</span>
          {!view.isDoctor && view.shown > 0 && <Button onClick={() => setConfirm({ kind: "adjust", rows: view.rows })}>{W3.adjustBulk}</Button>}
        </div>
      ) : null}
      {view.truncated && <div className="err" role="alert"><Icon name="alert" /> {t("TMP-Q028", "ja")}</div>}

      {view.rows.length === 0 && (dateMode ? view.totals.all === 0 : true) ? (
        <div className={s.empty}>
          <p>{t("SI015", "ja")}</p>
          {!view.isDoctor && dateMode && <a className="btn bp" href={`/staff/booking?date=${view.date}`}><Icon name="plus" size={16} />{W3.newBooking}</a>}
        </div>
      ) : view.rows.length > 0 && (
        <div className={s.wrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{W3.colTime}</th><th>{W3.colNo}</th><th>{W3.colName}</th>
                <th className={s.desk}>{W3.colVisit}</th><th className={s.desk}>{W3.colDoctor}</th><th className={s.tab}>{W3.colVisitDoctor}</th>
                <th>{W3.colState}</th><th>{W3.colQ}</th><th>{W3.colNotes}</th>
                {!view.isDoctor && <><th>{W3.colCheckin}</th><th>{W3.colMenu}</th></>}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => {
                const hl = view.highlight === r.bookingNo;
                const dr = `${r.doctorName}${r.unrequested ? ` ${W3.unrequested}` : ""}`;
                return (
                  <tr key={r.id} ref={hl ? hlRef : undefined} className={`${hl ? s.hl : ""} ${r.state === "CANCELED" ? s.grey : ""}`} data-booking={r.bookingNo}>
                    <td><b>{!dateMode && `${mdw(r.date)} `}{r.start.replace(/^0/, "")}〜{dateMode ? r.end.replace(/^0/, "") : ""}</b></td>
                    <td className={s.no}>{showNo(r.bookingNo)}</td>
                    <td>
                      {view.isDoctor ? <b>{r.name}</b> : <a href={`/staff/patients?patientId=${r.patientId}`}>{r.name}</a>}
                      <span className={s.kana}>{r.kana}</span><span className={s.tag}>{W3.channels[r.channel]}</span>
                    </td>
                    <td className={s.desk}>{r.first ? <span className={s.first}>{r.visitType}</span> : r.visitType}</td>
                    <td className={s.desk}>{dr}</td>
                    <td className={s.tab}>{r.visitType} / {dr}</td>
                    <td><span className={`${s.badge} ${s[`s_${r.state}`] ?? ""}`}>{r.badge}</span>{r.adjustNotified && <div className="mut">{w3(W3.adjusted, { at: r.adjustNotified })}</div>}</td>
                    <td>{r.hasQuestionnaire && <button type="button" className={s.mini} onClick={() => void openInfo(r)}>{W3.q}</button>}</td>
                    <td>{r.hasNotes && <button type="button" className={s.mini} onClick={() => void openInfo(r)}>{W3.notes}</button>}</td>
                    {!view.isDoctor && (
                      <>
                        <td>
                          {r.can.checkin && <Button className="btn-sm" onClick={() => void write(r, "checkin")}>{W3.checkin}</Button>}
                          {r.can.undo && <Button className="btn-sm" variant="secondary" onClick={() => void write(r, "undo")}>{W3.undo}</Button>}
                        </td>
                        <td>{r.state !== "CANCELED" ? rowMenu(r) : <select className={s.menu} aria-label={W3.menu} disabled><option>{W3.menu}</option></select>}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={s.foot}>{W3.footer}</div>
        </div>
      )}

      {cancelRow && (
        <div className="scrim-fixed" onKeyDown={(e) => { if (e.key === "Escape" && confirm === null) setCancelRow(null); trapTab(e); }}>
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="cd-title">
            <h3 id="cd-title">{w3(W3.cancelTitle, { no: showNo(cancelRow.bookingNo), name: cancelRow.name, start: cancelRow.start.replace(/^0/, "") })}</h3>
            <div className={s.dlgForm}>
              <label>{W3.reason} <span className="req">必須</span>
                <select
                  id="cd-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  onBlur={() => setErrors((p) => ({ ...p, reason: form.reason ? "" : t("SE001", "ja", { 項目: W3.field.reason }) }))}
                >
                  <option value="">選択してください</option>
                  {Object.entries(W3.reasons).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <FieldError id="cd-reason-e" message={errors.reason} />
              <input
                id="cd-text" type="text" maxLength={200} placeholder={W3.reasonPh} aria-label={W3.reasonText} value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
              <FieldError id="cd-text-e" message={errors.reasonText} />
              <div role="radiogroup" aria-label={W3.channel} id="cd-channel">
                <div>{W3.channel} <span className="req">必須</span></div>
                <div className={s.radios}>
                  {(["PHONE", "COUNTER"] as const).map((c) => (
                    <label key={c}><input type="radio" name="cd-ch" checked={form.channel === c} onChange={() => setForm({ ...form, channel: c })} />{c === "PHONE" ? W3.phone : W3.counter}</label>
                  ))}
                </div>
              </div>
              <FieldError id="cd-channel-e" message={errors.channel} />
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <Button variant="secondary" onClick={() => setCancelRow(null)}>{W3.cancelBtn}</Button>
                <Button variant="danger-fill" onClick={() => { if (checkCancel()) setConfirm("cancel"); }}>{W3.doCancel}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm === "cancel"} title={W3.dlgCancelTitle} messageId="SW010" confirmLabel={W3.doCancel} destructive onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!cancelRow) return;
          await act({ kind: "cancel", bookingId: cancelRow.id, version: cancelRow.version, reasonCode: form.reason, reasonText: form.text, channel: form.channel }, () => ["SI022"]);
        }}
      />
      <ConfirmDialog
        open={typeof confirm === "object" && confirm !== null && confirm.kind === "noshow"} title={W3.dlgNoShowTitle} messageId="SW011" onCancel={() => setConfirm(null)}
        onConfirm={async () => { if (typeof confirm === "object" && confirm?.kind === "noshow") await write(confirm.row, "noshow"); }}
      />
      <ConfirmDialog
        open={typeof confirm === "object" && confirm !== null && confirm.kind === "adjust"} title={W3.dlgAdjustTitle} messageId="SW012"
        params={{ n: typeof confirm === "object" && confirm?.kind === "adjust" ? confirm.rows.length : 0 }} onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (typeof confirm !== "object" || confirm?.kind !== "adjust") return;
          await act({ kind: "adjust", items: confirm.rows.map((r) => ({ bookingId: r.id, version: r.version })) }, (j) => ["SI016", { n: Number(j.n), m: Number(j.m) }]);
        }}
      />

      {info && (
        <div className="scrim-fixed" onKeyDown={(e) => { if (e.key === "Escape") setInfo(null); trapTab(e); }}>
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="qd-title">
            <h3 id="qd-title">{info.heading}</h3>
            {info.language && <p className="mut">{info.language}</p>}
            {info.answers.length > 0 && (
              <dl className={s.answers}>{info.answers.map((a) => <div key={a.id} style={{ display: "contents" }}><dt>{a.question}</dt><dd>{a.answer}</dd></div>)}</dl>
            )}
            {info.notes !== null && <p><b>{W3.notesPrefix}</b> {info.notes}</p>}
            <div className="row" style={{ justifyContent: "flex-end" }}><Button autoFocus variant="secondary" onClick={() => setInfo(null)}>{W3.close}</Button></div>
          </div>
        </div>
      )}
    </>
  );
}
