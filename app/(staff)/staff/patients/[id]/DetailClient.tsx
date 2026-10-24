"use client";

// spec-screen: S03
// 詳細 view. DOM order = Tab order of §4.1 (10 … 17 → 19-1 → 20-2 / 21 → 22-2 → 24 → 26 … 27 → 28 → 29 → 31 → 32); the
// two-column drawing and 32 above the summary are CSS grid areas, no positive tabindex.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, trapTab } from "@/components/ui/ConfirmDialog";
import { DateField } from "@/components/ui/DatePicker";
import { ErrorSummary, FieldError as FieldErrorText, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { PREFECTURES, type FieldError } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import type { PatientDetail, SearchRow } from "@/lib/staff/patients";
import {
  BOOKING_CHANNEL_LABEL, BOOKING_STATUS_LABEL, CANCEL_REASON_LABEL, checkCards, checkMergeBox, checkProfile, CONSENT_LABEL, NOTIFY_CHANNEL_LABEL,
  NOTIFY_EVENT_LABEL, NOTIFY_STATUS_LABEL, RELATION_LABEL, type ProfileValues,
} from "@/lib/staff/patients-rules";
import s from "../patients.module.css";

type MergeCard = { kind: string; name: string; birth: string; cards: string[]; web: boolean };
type Answer = {
  code?: string; params?: Record<string, string | number>; errors?: FieldError[]; rows?: SearchRow[]; confirm?: string;
  source?: MergeCard; target?: MergeCard; sourceUpdatedAt?: string; targetUpdatedAt?: string;
  questionnaire?: { title: string; language: string; answers: { key: string; value: string }[] };
};
const fid = (f: string) => `s03-${f}`;

export function DetailClient({ detail: d, admin, back }: { detail: PatientDetail; admin: boolean; back: string }) {
  const router = useRouter();
  const api = useApiFetch();
  const { toast } = useToast();
  const ro = !!d.merged;
  const [v, setV] = useState<ProfileValues>(d.profile);
  const [cards, setCards] = useState(d.cards.map((c) => ({ ...c })));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [towns, setTowns] = useState<string[]>([]);
  const [lastPostcode, setLastPostcode] = useState(d.profile.postcode);
  const [q, setQ] = useState<Answer["questionnaire"] | null>(null);
  const [mergeQuery, setMergeQuery] = useState("");
  const [candidates, setCandidates] = useState<SearchRow[] | null>(null);
  const [candInfo, setCandInfo] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [target, setTarget] = useState<SearchRow | null>(null);
  const [mergeDlg, setMergeDlg] = useState<Answer | null>(null);
  const [disclose, setDisclose] = useState(false);

  async function call(body: Record<string, unknown>) {
    const res = await api(...postJson("/api/staff/patients", { id: d.id, ...body }));
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Answer };
  }
  const refused = (j: Answer) => (j.errors ? setErrors(j.errors) : setBanner(t(j.code ?? "SE090", "ja", j.params)));
  const err = (f: string) => {
    const e = errors.find((x) => x.field === f);
    return e ? t(e.code, "ja", e.params) : null;
  };
  const allErrors = () => [...checkProfile(v, { phoneRequired: d.phoneRequired }), ...checkCards(cards.filter((c) => c.editable))];
  const blur = (f: string) => setErrors((prev) => [...prev.filter((e) => e.field !== f), ...allErrors().filter((e) => e.field === f)]);
  const set = (p: Partial<ProfileValues>) => setV({ ...v, ...p });

  // ── event 4: postcode lookup (only when the postcode changed, Q27) ─────────────────────────────────────────────────
  async function lookup() {
    blur("postcode");
    const code = v.postcode.normalize("NFKC").replace(/[^0-9]/g, "");
    if (!/^\d{7}$/.test(code) || code === lastPostcode) return;
    setLastPostcode(code);
    const res = await api(`/api/postcode?code=${code}`);
    if (!res) return;
    if (!res.ok) return setErrors((p) => [...p.filter((e) => e.field !== "postcode"), { field: "postcode", code: res.status === 404 ? "SE012" : "SE013" }]);
    const { candidates: c } = (await res.json()) as { candidates: { prefecture: string; city: string; town: string }[] };
    setV((cur) => ({ ...cur, prefecture: c[0].prefecture, city: c[0].city, town: c.length === 1 ? c[0].town : "" }));
    setTowns(c.length > 1 ? c.map((x) => x.town) : []);
  }

  // ── event 6 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async function save() {
    setBanner(null);
    const local = allErrors();
    setErrors(local);
    if (local.length) return document.getElementById(fid(local[0].field))?.focus();
    setBusy(true);
    try {
      const r = await call({ action: "save", updatedAt: d.updatedAt, profile: v, cards: cards.filter((c) => c.editable).map((c) => ({ clinicId: c.clinicId, cardNo: c.cardNo, updatedAt: c.updatedAt })) });
      if (!r) return;
      if (!r.ok) return refused(r.json);
      toast("SI030");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function confirmCard(clinicId: string, updatedAt: string | null) {
    setBanner(null);
    const r = await call({ action: "confirm", clinicId, updatedAt });
    if (!r) return;
    if (!r.ok) return refused(r.json);
    toast("SI030");
    router.refresh();
  }
  async function openQ(bookingId: string) {
    const r = await call({ action: "questionnaire", bookingId });
    if (r?.ok) setQ(r.json.questionnaire ?? null);
  }
  async function findTarget() {
    setCandInfo(null);
    const box = checkMergeBox(mergeQuery);
    setErrors((p) => [...p.filter((e) => e.field !== "mergeQuery"), ...box.errors]);
    if (box.errors.length) return;
    const r = await call({ action: "mergeSearch", query: mergeQuery });
    if (!r) return;
    if (!r.ok) return refused(r.json);
    setCandidates(r.json.rows ?? []);
    setCursor(0);
    setCandInfo(r.json.code ? t(r.json.code, "ja") : null);
  }
  async function askMerge() {
    if (!target) return;
    setBanner(null);
    const r = await call({ action: "mergeCheck", targetId: target.id });
    if (!r) return;
    if (!r.ok) return refused(r.json);
    setMergeDlg(r.json);
  }
  async function doMerge() {
    if (!target || !mergeDlg) return;
    setBusy(true);
    const r = await call({ action: "merge", targetId: target.id, sourceUpdatedAt: mergeDlg.sourceUpdatedAt, targetUpdatedAt: mergeDlg.targetUpdatedAt });
    setBusy(false);
    setMergeDlg(null);
    if (!r) return;
    if (!r.ok) return refused(r.json);
    toast("SI031");
    router.refresh();
  }
  async function doDisclose() {
    const r = await call({ action: "disclosure" });
    setDisclose(false);
    if (!r) return;
    if (!r.ok) return refused(r.json);
    toast("SI032");
  }
  async function openBooking(b: PatientDetail["bookings"][number]) {
    // T087: S01 at the booking's date; another clinic of the staff switches the session clinic first
    const res = await api(...postJson("/api/session/clinic", { clinicId: b.clinicId }));
    if (!res || (await openStaffErrorScreen(res))) return;
    router.push(`/staff/ledger?date=${b.date}&booking=${b.bookingNo.replace("-", "")}`); // S01 highlights by 予約番号 (Q18)
  }
  const candKeys = (e: React.KeyboardEvent) => {
    const list = candidates ?? [];
    if (e.key === "ArrowDown") setCursor(Math.min(cursor + 1, list.length - 1));
    else if (e.key === "ArrowUp") setCursor(Math.max(cursor - 1, 0));
    else if (e.key === "Enter" && list[cursor]) setTarget(list[cursor]);
    else return;
    e.preventDefault();
  };

  const field = (f: keyof ProfileValues | string, label: string, control: React.ReactNode, req = true) => (
    <div className={s.f}>
      <div className={s.lab}><label htmlFor={fid(f)}>{label}</label>{req && <RequiredMark lang="ja" />}</div>
      {control}
      <FieldErrorText id={`e-${f}`} message={err(f)} />
    </div>
  );
  const text = (f: keyof ProfileValues, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={fid(f)} className="inp" value={v[f] as string} disabled={ro} aria-describedby={`e-${f}`} onChange={(e) => set({ [f]: e.target.value })} onBlur={() => blur(f)} {...extra} />
  );
  const radios = (f: "nameType" | "sex", opts: [string, string][], label: string) => (
    <fieldset className={s.f} id={fid(f)} tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) blur(f); }}>
      <legend className={s.lab}>{label} <RequiredMark lang="ja" /></legend>
      <div className={s.radios}>
        {opts.map(([val, lab]) => (
          <label key={val}><input type="radio" name={`s03-${f}`} checked={v[f] === val} disabled={ro} onChange={() => set({ [f]: val })} />{lab}</label>
        ))}
      </div>
      <FieldErrorText id={`e-${f}`} message={err(f)} />
    </fieldset>
  );

  const editableState = !ro;
  return (
    <div className={s.detail}>
      <section className={s.head}>
        <div className={s.name}>{d.header.name}</div>
        <div className={s.help}>{d.header.kana}・{d.header.birth}（{d.header.age}歳）・{d.header.sex}</div>
        <div className={s.tags}>
          {d.tags.web && <span className="badge">Web会員</span>}
          {d.tags.bounced && <span className="badge badge-warn">メール不達</span>}
          {d.tags.gaiji && <span className="badge badge-warn">外字あり</span>}
          {d.tags.merged && <span className="badge">統合済</span>}
          {d.merged && <a className="lnk" href={`/staff/patients/${d.merged.id}`}>統合先を開く →</a>}
        </div>
        {banner && <div className="err" role="alert"><Icon name="alert" /> {banner}</div>}
        <ErrorSummary errors={errors.map((e) => ({ fieldId: fid(e.field), message: t(e.code, "ja", e.params) }))} lang="ja" />
      </section>

      <section className={`${s.card} ${s.aBasic}`}>
        <h2>基本情報</h2>
        {radios("nameType", [["JP", "日本語氏名"], ["ROMAJI", "ローマ字氏名"]], "氏名の種類")}
        <div className={s.pair}>
          {field("familyName", "姓", text("familyName"))}
          {field("givenName", "名", text("givenName"))}
        </div>
        <div className={s.pair}>
          {field("familyNameKana", "セイ", text("familyNameKana"))}
          {field("givenNameKana", "メイ", text("givenNameKana"))}
        </div>
        {field("birthDate", "生年月日", <DateField id={fid("birthDate")} value={v.birthDate} disabled={ro} onChange={(x) => set({ birthDate: x })} onBlur={() => blur("birthDate")} lang="ja" ariaLabel="生年月日" describedBy="e-birthDate" />)}
        {radios("sex", [["1", "男性"], ["2", "女性"]], "性別")}
        {field("postcode", "郵便番号", text("postcode", { inputMode: "numeric", onBlur: () => void lookup() }))}
        {field("prefecture", "都道府県", (
          <select id={fid("prefecture")} className="inp" value={v.prefecture} disabled={ro} onChange={(e) => set({ prefecture: e.target.value })} onBlur={() => blur("prefecture")}>
            <option value="">選択してください</option>
            {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ))}
        {field("city", "市区町村", text("city"))}
        {field("town", "町域", towns.length > 0 ? (
          <select id={fid("town")} className="inp" value={towns.includes(v.town) ? v.town : ""} onChange={(e) => { set({ town: e.target.value }); if (!e.target.value) setTowns([]); }}>
            {towns.map((x) => <option key={x} value={x}>{x}</option>)}
            <option value="">その他（直接入力）</option>
          </select>
        ) : text("town"), false)}
        {field("addressLine", "番地", text("addressLine"))}
        {field("building", "建物名", text("building"), false)}
        {field("phone", "電話番号", text("phone", { inputMode: "numeric" }), d.phoneRequired)}
        <label className={s.check}>
          <input type="checkbox" checked={v.smsOptIn} disabled={ro || !d.smsEditable} onChange={(e) => set({ smsOptIn: e.target.checked })} />
          SMSでの予約通知に同意を得た（窓口・電話登録の患者のみ）
        </label>
      </section>

      <section className={`${s.card} ${s.aAccount}`}>
        <h2>アカウント情報 <span className="badge">閲覧のみ</span></h2>
        {d.account ? (
          <dl className={s.dl}>
            <dt>メール</dt><dd>{d.account.email}</dd><dt>状態</dt><dd>{d.account.status}</dd><dt>通知方法</dt><dd>{d.account.channel}</dd>
            <dt>表示言語</dt><dd>{d.account.language}</dd><dt>最終ログイン</dt><dd>{d.account.lastLogin}</dd>
          </dl>
        ) : <p>なし</p>}
      </section>

      <section className={`${s.card} ${s.aFamily}`}>
        <h2>家族（同じアカウント）</h2>
        <table className={s.table}>
          <thead><tr><th>氏名</th><th>続柄</th><th>生年月日</th></tr></thead>
          <tbody>
            {d.family.map((m) => (
              <tr key={m.id}>
                <td>{m.current ? <>{m.name}（表示中）</> : <a className="lnk" href={`/staff/patients/${m.id}`}>{m.name}</a>}</td>
                <td>{RELATION_LABEL[m.relation] ?? "—"}</td><td>{m.birth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${s.card} ${s.aCards}`}>
        <h2>診察券番号</h2>
        <table className={s.table}>
          <thead><tr><th>クリニック</th><th>番号</th><th>状態</th><th /></tr></thead>
          <tbody>
            {cards.map((c, i) => (
              <tr key={c.clinicId}>
                <td>{c.clinicName}</td>
                <td>
                  <input
                    id={fid(`card.${c.clinicId}`)} className="inp" aria-label={`診察券番号 ${c.clinicName}`} value={c.cardNo} disabled={ro || !c.editable}
                    onChange={(e) => setCards(cards.map((x, j) => (j === i ? { ...x, cardNo: e.target.value } : x)))} onBlur={() => blur(`card.${c.clinicId}`)}
                  />
                  <FieldErrorText id={`e-card.${c.clinicId}`} message={err(`card.${c.clinicId}`)} />
                </td>
                <td>{c.stored ? (c.confirmed ? <span className="badge">確認済</span> : <span className="badge badge-warn">未確認</span>) : ""}</td>
                <td>{editableState && c.stored && !c.confirmed && c.editable && <Button variant="secondary" onClick={() => void confirmCard(c.clinicId, c.updatedAt)}>確認する</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${s.card} ${s.aBook}`}>
        <h2>予約履歴</h2>
        <p>無断キャンセル {d.noShow.total}回 （直近6か月 {d.noShow.recent}回）</p>
        <table className={s.table}>
          <thead><tr><th>日時</th><th>予約番号</th><th>クリニック</th><th>状態</th><th>経路</th><th>取消理由</th><th>問診</th></tr></thead>
          <tbody>
            {d.bookings.map((b) => (
              <tr key={b.id}>
                <td>{b.when}</td>
                <td>{b.mine && !ro ? <button type="button" className="lnk-btn" onClick={() => void openBooking(b)}>{b.bookingNo}</button> : b.bookingNo}</td>
                <td>{b.clinicName}</td><td>{BOOKING_STATUS_LABEL[b.status]}</td><td>{BOOKING_CHANNEL_LABEL[b.channel]}</td>
                <td>{b.reason ? CANCEL_REASON_LABEL[b.reason] : ""}</td>
                <td>{b.questionnaire && b.mine && !ro && <Button variant="secondary" onClick={() => void openQ(b.id)}>問診を見る</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${s.card} ${s.aNotice}`}>
        <h2>通知履歴</h2>
        <table className={s.table}>
          <thead><tr><th>種類</th><th>経路</th><th>状態</th><th>登録</th><th>送信</th><th>試行</th><th>エラー</th></tr></thead>
          <tbody>
            {d.notifications.map((n) => (
              <tr key={n.id} className={n.status === "FAILED" || n.status === "BOUNCED" ? s.failed : ""}>
                <td>{NOTIFY_EVENT_LABEL[n.event]}</td><td>{NOTIFY_CHANNEL_LABEL[n.channel]}</td><td>{NOTIFY_STATUS_LABEL[n.status]}</td>
                <td>{n.queued}</td><td>{n.sent}</td><td>{n.attempts}</td><td>{n.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={`${s.card} ${s.aConsent}`}>
        <h2>同意履歴 <span className="badge">閲覧のみ</span></h2>
        {d.account ? (
          <table className={s.table}>
            <thead><tr><th>種類</th><th>版</th><th>同意日時</th></tr></thead>
            <tbody>{d.consents.map((c, i) => <tr key={i}><td>{CONSENT_LABEL[c.kind] ?? c.kind}</td><td>{c.version}</td><td>{c.at}</td></tr>)}</tbody>
          </table>
        ) : <p>なし</p>}
      </section>

      <section className={`${s.card} ${s.aMerge}`}>
        <h2>重複患者の統合</h2>
        {d.merged ? (
          <p>統合先: {d.merged.name}・{d.merged.birth}</p>
        ) : (
          <>
            <label htmlFor={fid("mergeQuery")} className={s.lab}>統合先の患者（この記録を統合先へ移す）</label>
            <div className={s.row}>
              <input id={fid("mergeQuery")} className="inp" placeholder="フリガナ・電話番号・診察券番号で検索" value={mergeQuery} aria-describedby="e-mergeQuery" onChange={(e) => setMergeQuery(e.target.value)} />
              <Button variant="secondary" onClick={() => void findTarget()}>検索</Button>
            </div>
            <FieldErrorText id="e-mergeQuery" message={err("mergeQuery")} />
            {candInfo && <div className="info" role="status">{candInfo}</div>}
            {candidates && candidates.length > 0 && (
              <table className={s.table} tabIndex={0} aria-label="統合先の候補" aria-activedescendant={fid(`cand-${cursor}`)} onKeyDown={candKeys}>
                <tbody>
                  {candidates.map((c, i) => (
                    <tr key={c.id} id={fid(`cand-${i}`)} className={i === cursor || target?.id === c.id ? s.sel : ""} onClick={() => setTarget(c)} data-row>
                      <td>{c.name}</td><td>{c.birth}</td><td>{c.phone}</td><td>{c.card}</td><td>{c.kind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {target && <p>{target.name}・{target.birth.slice(0, 10)}</p>}
          </>
        )}
        <p className={s.help}>統合先のプロフィールを残し、予約・診察券・通知（アカウント）を移します。</p>
        {!ro && <Button variant="danger" disabled={!target} onClick={() => void askMerge()}>統合する</Button>}
      </section>

      <div className={s.actions}>
        <Button busy={busy} disabled={ro} onClick={() => void save()}>保存する</Button>
        {!ro && <a className="btn bs" href={`/staff/booking?patientId=${d.id}`}>この患者で予約</a>}
        {admin && !ro && <Button variant="secondary" onClick={() => setDisclose(true)}>開示用データ出力</Button>}
      </div>

      <a className={`lnk ${s.back}`} href={`/staff/patients${back ? `?${back}` : ""}`}>検索結果へ戻る</a>

      {q && (
        <div className="scrim-fixed" onKeyDown={(e) => { if (e.key === "Escape") setQ(null); trapTab(e); }}>
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="s03-q-title">
            <h3 id="s03-q-title">{q.title}</h3>
            <p className="mut">回答言語: {q.language}</p>
            <dl className={s.dl}>{q.answers.map((x, i) => <div key={i}><dt>{x.key}</dt><dd>{x.value}</dd></div>)}</dl>
            <div className="row" style={{ justifyContent: "flex-end" }}><Button variant="secondary" autoFocus onClick={() => setQ(null)}>閉じる</Button></div>
          </div>
        </div>
      )}

      {mergeDlg && (
        <div className="scrim-fixed" onKeyDown={(e) => { if (e.key === "Escape") setMergeDlg(null); trapTab(e); }}>
          <div className="dlg" role="alertdialog" aria-modal="true" aria-labelledby="s03-m-title">
            <h3 id="s03-m-title">患者を統合しますか？</h3>
            <div className={s.mergeCards}>
              {[["統合元", mergeDlg.source, ""], ["統合先", mergeDlg.target, " — 残す"]].map(([cap, c, tail]) => {
                const card = c as MergeCard;
                return (
                  <div key={cap as string} className={s.mergeCard}>
                    <b>{cap as string}（{card.kind || "—"}）{tail as string}</b>
                    <div>{card.name}</div><div>{card.birth}</div><div>{card.cards.join(" / ") || "診察券なし"}</div><div>{card.web ? "Web会員" : "Webアカウントなし"}</div>
                  </div>
                );
              })}
            </div>
            <p className="mut">{t("SW030", "ja", mergeDlg.params)}</p>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn bs" autoFocus onClick={() => setMergeDlg(null)}>キャンセル</button>
              <Button variant="danger-fill" busy={busy} onClick={() => void doMerge()}>統合する</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={disclose} title="開示用データを出力しますか？" messageId="SW031" onConfirm={doDisclose} onCancel={() => setDisclose(false)} />
    </div>
  );
}
