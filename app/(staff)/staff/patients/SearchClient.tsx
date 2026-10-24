"use client";

// spec-screen: S03
// 検索 view: states 基 (no search), ① results (≤ 100, SI034 over), ② none (SI033). 4.2 No. 1–6 run on press; the server re-runs them.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DatePicker";
import { ErrorSummary, FieldError as FieldErrorText } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import type { FieldError } from "@/lib/auth/validate";
import { t } from "@/lib/i18n";
import type { SearchRow } from "@/lib/staff/patients";
import { checkSearch, SEARCH_KEYS, type SearchInput } from "@/lib/staff/patients-rules";
import s from "./patients.module.css";

const fid = (f: string) => `s03-${f}`;
export const queryOf = (v: SearchInput) => new URLSearchParams(SEARCH_KEYS.filter((k) => v[k].trim() !== "").map((k) => [k, v[k]])).toString();

export function SearchClient({ input, clinicName, result, errors: serverErrors }: {
  input: SearchInput; clinicName: string; result: { rows: SearchRow[]; over: boolean } | null; errors: FieldError[];
}) {
  const router = useRouter();
  const [v, setV] = useState(input);
  const [errors, setErrors] = useState<FieldError[]>(serverErrors);
  const [cursor, setCursor] = useState(0);
  const back = queryOf(input);

  function search() {
    const { errors: e } = checkSearch(v);
    setErrors(e);
    if (e.length) return document.getElementById(fid(e[0].field))?.focus();
    const q = queryOf(v);
    router.push(`/staff/patients?${q}`);
  }
  const open = (id: string) => router.push(`/staff/patients/${id}${back ? `?back=${encodeURIComponent(back)}` : ""}`);
  const err = (f: string) => {
    const e = errors.find((x) => x.field === f);
    return e ? t(e.code, "ja", e.params) : null;
  };
  const rows = result?.rows ?? [];
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setCursor(Math.min(cursor + 1, rows.length - 1));
    else if (e.key === "ArrowUp") setCursor(Math.max(cursor - 1, 0));
    else if (e.key === "Enter" && rows[cursor]) open(rows[cursor].id);
    else return;
    e.preventDefault();
  };
  const field = (k: keyof SearchInput, label: string, control?: React.ReactNode) => (
    <div className={s.f}>
      <label htmlFor={fid(k)} className={s.lab}>{label}</label>
      {control ?? <input id={fid(k)} className="inp" value={v[k]} aria-describedby={`e-${k}`} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
      <FieldErrorText id={`e-${k}`} message={err(k)} />
    </div>
  );

  return (
    <div className={s.page}>
      <h1 className={s.h1}>患者検索</h1>
      <ErrorSummary errors={errors.map((e) => ({ fieldId: fid(e.field), message: t(e.code, "ja", e.params) }))} lang="ja" />
      <form className={s.searchForm} onSubmit={(e) => { e.preventDefault(); search(); }}>
        {field("kana", "フリガナ")}
        {field("name", "氏名")}
        {field("phone", "電話番号")}
        {field("birth", "生年月日", <DateField id={fid("birth")} value={v.birth} onChange={(x) => setV({ ...v, birth: x })} lang="ja" ariaLabel="生年月日" describedBy="e-birth" />)}
        {field("card", `診察券番号（${clinicName}）`)}
        {field("bookingNo", "予約番号")}
        <div className={s.searchAct}>
          <Button type="submit"><Icon name="search" size={16} /> 検索する</Button>
          <span className={s.help}>1つ以上の条件を入力（部分一致・ひらがな可）</span>
        </div>
      </form>

      {result && rows.length === 0 && <div className="info" role="status">{t("SI033", "ja")}</div>}
      {result?.over && <div className="info" role="status">{t("SI034", "ja")}</div>}
      {rows.length > 0 && (
        <section className={s.card}>
          <div className={s.count}>{rows.length}件</div>
          <table className={s.table} tabIndex={0} aria-label="検索結果" aria-activedescendant={fid(`row-${cursor}`)} onKeyDown={keys}>
            <thead>
              <tr><th>氏名</th><th>フリガナ</th><th>生年月日</th><th>電話番号</th><th>診察券（{clinicName}）</th><th>区分</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} id={fid(`row-${i}`)} className={i === cursor ? s.sel : ""} onClick={() => open(r.id)} data-row>
                  <td>{r.name}</td><td>{r.kana}</td><td>{r.birth}</td><td>{r.phone}</td><td>{r.card}</td><td>{r.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={s.help}>統合済みの患者は表示しない。最大100件。行クリックで詳細（閲覧を監査ログに記録）。</p>
        </section>
      )}
    </div>
  );
}
