"use client";

// spec-screen: A06
// CSV出力: 夜間出力状況 (1 / 1-1), 手動出力 (2–5; ② running disables 5 and makes 2 / 3 read-only), ファイル一覧 (6, 7; ④ none).
// The period is checked inline (event 2) and again by the server at 出力する. SI080 / SI081 are toasts (Q5 A).
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorSummary, FieldError as FieldErrorText, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { checkPeriod, KINDS, type ExportKindValue } from "@/lib/admin/export-rules";
import type { ExportState } from "@/lib/admin/export";
import type { FieldError } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import { A06 } from "@/lib/i18n/labels-a06";
import s from "./export.module.css";

type Outcome = { code: string; params?: Record<string, string | number> };

export function ExportClient({ initial }: { initial: ExportState }) {
  const { toast } = useToast();
  const api = useApiFetch();
  const [state, setState] = useState(initial);
  const [kind, setKind] = useState<ExportKindValue>("BOTH"); // Q3 A
  const [from, setFrom] = useState(initial.defaults.from);
  const [to, setTo] = useState(initial.defaults.to);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState<Outcome | null>(null); // SE084 / SE090 under 5

  const msg = (e: FieldError) => t(e.code, "ja", e.params);
  const err = (f: string) => {
    const e = errors.find((x) => x.field === f);
    return e ? msg(e) : null;
  };
  const refresh = async () => {
    const res = await api("/api/admin/export/state");
    if (!res || (await openStaffErrorScreen(res))) return;
    const json = (await res.json().catch(() => ({}))) as { state?: ExportState };
    if (json.state) setState(json.state);
  };

  // event 2
  const blurPeriod = () => setErrors(checkPeriod(kind, from, to));

  // event 3
  async function run() {
    setBox(null);
    const local = checkPeriod(kind, from, to);
    setErrors(local);
    if (local.length) return document.getElementById(`a06-${local[0].field}`)?.focus();
    setBusy(true);
    try {
      const res = await api(...postJson("/api/admin/export/run", { kind, from, to }));
      if (!res || (await openStaffErrorScreen(res))) return;
      const json = (await res.json().catch(() => ({}))) as { errors?: FieldError[]; outcome?: Outcome };
      if (!res.ok) return setErrors(json.errors ?? []);
      const o = json.outcome;
      if (o && (o.code === "SI080" || o.code === "SI081")) toast(o.code, { params: o.params });
      else setBox(o ?? { code: "SE090" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // event 4
  async function download(id: string, fileName: string) {
    setBox(null);
    const res = await api(`/api/admin/export/download?id=${id}`);
    if (!res) return;
    if (res.status === 409 || res.status === 500) return setBox({ code: "SE090" }); // 4-3: stay
    if (!res.ok) {
      if (await openStaffErrorScreen(res)) return;
      return setBox({ code: "SE090" });
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    await refresh();
  }

  const failed = state.last.failedAt !== null; // state ①
  const summary = errors.map((e) => ({ fieldId: `a06-${e.field}`, message: msg(e) }));
  return (
    <div className={s.page}>
      <h1 className={s.h1}>{A06.heading}</h1>
      {failed ? (
        <div className="err" role="alert">
          <Icon name="alert" /> {t("SE082", "ja", { 日時: state.last.failedAt! })}
        </div>
      ) : (
        <div className={s.status}>
          {A06.nightly} {state.last.text}
        </div>
      )}
      <div className={s.layout}>
        <section className={s.card} aria-labelledby="a06-manual">
          <h2 id="a06-manual">{A06.manual}</h2>
          <ErrorSummary errors={summary} lang="ja" />
          <fieldset className={s.f} disabled={busy}>
            <legend className={s.lab}>
              {A06.kindLabel} <RequiredMark lang="ja" />
            </legend>
            <div className={s.row} role="radiogroup" aria-label={A06.kindLabel}>
              {KINDS.map((k) => (
                <label key={k} className={s.radio}>
                  <input type="radio" name="a06-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                  {A06.kinds[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={s.f} disabled={busy}>
            <legend className={s.lab}>
              {A06.periodLabel} <RequiredMark lang="ja" /> <span className={s.help}>{A06.periodHelp}</span>
            </legend>
            <div className={s.row}>
              <input id="a06-from" className={`${s.date} inp`} inputMode="numeric" maxLength={10} value={from} aria-label={`${A06.periodLabel} ${A06.from}`}
                aria-invalid={!!err("from")} aria-describedby="a06-from-e" onChange={(e) => setFrom(e.target.value)} onBlur={blurPeriod} />
              {A06.to}
              <input id="a06-to" className={`${s.date} inp`} inputMode="numeric" maxLength={10} value={to} aria-label={`${A06.periodLabel} ${A06.until}`}
                aria-invalid={!!err("to")} aria-describedby="a06-to-e" onChange={(e) => setTo(e.target.value)} onBlur={blurPeriod} />
            </div>
            <FieldErrorText id="a06-from-e" message={err("from")} />
            <FieldErrorText id="a06-to-e" message={err("to")} />
          </fieldset>
          <div className={s.since}>{state.since}</div>
          <Button className={failed ? s.hl : ""} busy={busy} busyLabel={A06.running} onClick={run}>
            {A06.run}
          </Button>
          <p className={s.note}>{A06.note}</p>
          {box && (
            <div className="err" role="alert">
              <Icon name="alert" /> {t(box.code, "ja", box.params)}
            </div>
          )}
        </section>
        <section className={s.card} aria-labelledby="a06-list">
          <h2 id="a06-list">
            {A06.listHeading} <span className={s.help}>{A06.listSub}</span>
          </h2>
          {state.rows.length === 0 ? (
            <p>{A06.none}</p>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    {Object.values(A06.cols).map((c) => (
                      <th key={c} scope="col">{c}</th>
                    ))}
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.fileName}
                        {r.se083 && (
                          <div className={s.se083}>
                            <Icon name="alert" size={14} />
                            {t("SE083", "ja", { 日時: r.se083 })}
                          </div>
                        )}
                      </td>
                      <td>{A06.kindWord[r.kind]}</td>
                      <td>{A06.tag[r.tag]}</td>
                      <td>{A06.status[r.status]}</td>
                      <td>{r.period}</td>
                      <td>
                        {r.count}
                        {r.warnings > 0 && <span className={s.warn}>{A06.warning(r.warnings)}</span>}
                      </td>
                      <td>{r.creator}</td>
                      <td>{r.downloads}</td>
                      <td>{r.expires}</td>
                      <td>
                        {r.status === "DONE" && (
                          <Button variant="secondary" onClick={() => download(r.id, r.fileName)}>
                            {A06.download}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={s.note}>{A06.footnote}</p>
        </section>
      </div>
    </div>
  );
}
