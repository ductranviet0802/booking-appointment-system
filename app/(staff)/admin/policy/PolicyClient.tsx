"use client";

// spec-screen: A04
// 通知・ポリシー: template tab (基 / ② mail-only event / ③ SMS over 70) and policy tab (①). Saving acts on the shown tab only;
// edits of both tabs are held while the screen stays open (Q3). W messages are a server round trip (Q10).
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorSummary, FieldError as FieldErrorText, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import type { PolicyForm, PolicyState, TemplateRow } from "@/lib/admin/policy";
import {
  CHANNEL_LABEL, CHANNELS, channelsOf, EVENT_LABEL, EVENTS, FRAME_MINUTES, LANGUAGE_LABEL, LANGUAGES, PLACEHOLDERS, placeholdersOf, SMS_LIMIT,
  validatePolicy, validateTemplate, type ChannelCode, type EventCode, type LanguageCode, type PolicyValues,
} from "@/lib/admin/policy-rules";
import type { FieldError } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import s from "./policy.module.css";

type Answer = {
  code?: string; params?: Record<string, string | number>; errors?: FieldError[]; confirm?: "SW061" | "SW062";
  template?: TemplateRow; policy?: PolicyForm; preview?: { subject: string | null; body: string; count: number | null };
};
type Tab = "template" | "policy";
type Dialog = { id: "SW061" | "SW062"; params: Record<string, string | number> } | null;

const fid = (f: string) => `a04-${f}`;

export function PolicyClient({ initial }: { initial: PolicyState }) {
  const { toast } = useToast();
  const api = useApiFetch();
  const [tab, setTab] = useState<Tab>("template");
  const [combo, setCombo] = useState<{ event: EventCode; channel: ChannelCode; language: LanguageCode }>({ event: "NT01_BOOKED", channel: "MAIL", language: "JA" });
  const [tpl, setTpl] = useState({ subject: initial.template.subject, body: initial.template.body });
  const [pol, setPol] = useState<PolicyValues>(initial.policy);
  const [preview, setPreview] = useState<Answer["preview"] | null>(null);
  const [errors, setErrors] = useState<{ template: FieldError[]; policy: FieldError[] }>({ template: [], policy: [] });
  const [banner, setBanner] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const lastField = useRef<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const names = placeholdersOf(combo.event);
  const over = preview?.count != null && preview.count > SMS_LIMIT;
  const tabErrors = errors[tab];

  async function call(url: string, init?: RequestInit) {
    const res = await api(url, init);
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Answer };
  }
  const setTabErrors = (e: FieldError[]) => setErrors((prev) => ({ ...prev, [tab]: e }));
  const err = (f: string) => {
    const e = tabErrors.find((x) => x.field === f);
    return e ? t(e.code, "ja", e.params) : null;
  };

  // ── event 2 ────────────────────────────────────────────────────────────────────────────────────────────────────
  async function choose(patch: Partial<typeof combo>) {
    const next = { ...combo, ...patch };
    if (!channelsOf(next.event).includes(next.channel)) next.channel = "MAIL"; // 2-3, Q5 a
    setCombo(next);
    setPreview(null);
    setBanner(null);
    setErrors((prev) => ({ ...prev, template: [] }));
    const r = await call(`/api/admin/policy/template?${new URLSearchParams(next)}`);
    if (r?.ok && r.json.template) setTpl({ subject: r.json.template.subject, body: r.json.template.body });
  }

  // ── event 3 ────────────────────────────────────────────────────────────────────────────────────────────────────
  function insert(name: string) {
    const target = combo.channel === "MAIL" ? lastField.current : "body";
    const el = target === "subject" ? subjectRef.current : bodyRef.current;
    const value = tpl[target];
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setTpl({ ...tpl, [target]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  const listKeys = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = Math.min(Math.max(cursor + step, 0), names.length - 1);
    setCursor(next);
    document.getElementById(fid(`ph-${next}`))?.focus();
  };

  // ── event 4 ────────────────────────────────────────────────────────────────────────────────────────────────────
  async function runPreview() {
    const r = await call(...postJson("/api/admin/policy/preview", { ...combo, ...tpl }));
    if (r?.ok) setPreview(r.json.preview ?? null);
  }

  // ── event 5 ────────────────────────────────────────────────────────────────────────────────────────────────────
  function blurTemplate(f: "subject" | "body") {
    const found = validateTemplate(combo.channel, tpl).filter((e) => e.field === f);
    setErrors((prev) => ({ ...prev, template: [...prev.template.filter((e) => e.field !== f || e.code === "SE060"), ...found] }));
  }
  function blurPolicy(f: string) {
    const found = validatePolicy(pol).filter((e) => e.field === f);
    setErrors((prev) => ({ ...prev, policy: [...prev.policy.filter((e) => e.field !== f), ...found] }));
  }

  // ── events 6–8 ─────────────────────────────────────────────────────────────────────────────────────────────────
  async function save(confirmed = false) {
    setBanner(null);
    const local = tab === "template" ? validateTemplate(combo.channel, tpl) : validatePolicy(pol);
    if (local.length > 0) {
      setTabErrors(local);
      document.getElementById(fid(local[0].field))?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = tab === "template"
        ? await call(...postJson("/api/admin/policy/template", { ...combo, ...tpl, confirmed }))
        : await call(...postJson("/api/admin/policy/save", { ...pol, confirmed }));
      setDialog(null);
      if (!r) return;
      if (!r.ok) {
        if (r.json.errors) return setTabErrors(r.json.errors);
        setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
        return;
      }
      if (r.json.confirm) return setDialog({ id: r.json.confirm, params: r.json.params ?? {} });
      setTabErrors([]);
      if (r.json.policy) setPol(r.json.policy);
      toast("SI060");
    } finally {
      setBusy(false);
    }
  }

  const tabKeys = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "template" ? "policy" : "template";
    setTab(next);
    requestAnimationFrame(() => document.getElementById(fid(`tab-${next}`))?.focus());
  };

  const summary = tabErrors.map((e) => ({ fieldId: fid(e.field), message: t(e.code, "ja", e.params) }));
  const setP = (p: Partial<PolicyValues>) => setPol({ ...pol, ...p });

  function pfield(label: string, f: keyof PolicyValues, help: string, control: React.ReactNode, req = true) {
    return (
      <div className={s.f}>
        <div className={s.lab}><label htmlFor={fid(f)}>{label}</label>{req && <RequiredMark lang="ja" />}</div>
        {control}
        <div className={s.help}>{help}</div>
        <FieldErrorText id={`e-${f}`} message={err(f)} />
      </div>
    );
  }
  const num = (f: keyof PolicyValues, width = 80, disabled = false) => (
    <input
      id={fid(f)} className={`inp ${s.short}`} style={{ width }} inputMode="numeric" value={pol[f] as string} disabled={disabled}
      aria-describedby={`e-${f}`} onChange={(e) => setP({ [f]: e.target.value })} onBlur={() => blurPolicy(f)}
    />
  );

  return (
    <div className={s.page}>
      <h1 className={s.h1}>通知・ポリシー</h1>
      <div className={s.tabRow}>
        <div role="tablist" aria-label="通知・ポリシー" className={s.tabs} onKeyDown={tabKeys}>
          {(["template", "policy"] as const).map((k) => (
            <button
              key={k} id={fid(`tab-${k}`)} type="button" role="tab" aria-selected={tab === k} tabIndex={tab === k ? 0 : -1}
              className={tab === k ? s.tabOn : s.tab} onClick={() => { setTab(k); setBanner(null); }}
            >
              {k === "template" ? "通知テンプレート" : "予約ポリシー"}
            </button>
          ))}
        </div>
        <div className={s.count}><Icon name="alert" size={14} /> LINE送信数（今月）：<b>{initial.lineCount.toLocaleString("ja-JP")}通</b></div>
      </div>

      {banner && <div className="err" role="alert"><Icon name="alert" /> {banner}</div>}
      <ErrorSummary errors={summary} lang="ja" />

      {tab === "template" ? (
        <section className={s.card}>
          <div className={s.pick}>
            <div className={s.f}>
              <div className={s.lab}><label htmlFor={fid("event")}>通知の種類</label><RequiredMark lang="ja" /></div>
              <select id={fid("event")} className="inp" value={combo.event} onChange={(e) => void choose({ event: e.target.value as EventCode })}>
                {EVENTS.map((ev) => <option key={ev} value={ev}>{EVENT_LABEL[ev]}</option>)}
              </select>
            </div>
            <fieldset className={s.f}>
              <legend className={s.lab}>送信方法 <RequiredMark lang="ja" /></legend>
              <div className={s.seg}>
                {CHANNELS.map((c) => (
                  <label key={c} className={combo.channel === c ? s.segOn : ""}>
                    <input type="radio" name="a04-channel" value={c} checked={combo.channel === c} disabled={!channelsOf(combo.event).includes(c)} onChange={() => void choose({ channel: c })} />
                    {CHANNEL_LABEL[c]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={s.f}>
              <legend className={s.lab}>言語 <RequiredMark lang="ja" /></legend>
              <div className={s.row}>
                <div className={s.seg}>
                  {LANGUAGES.map((l) => (
                    <label key={l} className={combo.language === l ? s.segOn : ""}>
                      <input type="radio" name="a04-language" value={l} checked={combo.language === l} onChange={() => void choose({ language: l })} />
                      {LANGUAGE_LABEL[l]}
                    </label>
                  ))}
                </div>
                <span className={s.help}>英語・ベトナム語が空の場合は日本語で送信します。</span>
              </div>
            </fieldset>
          </div>

          <div className={s.editor}>
            <div className={s.col}>
              {combo.channel === "MAIL" && (
                <div className={s.f}>
                  <div className={s.lab}><label htmlFor={fid("subject")}>件名</label><span className={s.help}>メールのみ・100文字まで</span><RequiredMark lang="ja" /></div>
                  <input
                    id={fid("subject")} ref={subjectRef} className="inp" value={tpl.subject} aria-describedby="e-subject"
                    onFocus={() => { lastField.current = "subject"; }} onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} onBlur={() => blurTemplate("subject")}
                  />
                  <FieldErrorText id="e-subject" message={err("subject")} />
                </div>
              )}
              <div className={s.f}>
                <div className={s.lab}><label htmlFor={fid("body")}>本文</label><RequiredMark lang="ja" /></div>
                <textarea
                  id={fid("body")} ref={bodyRef} className={`inp ${s.body}`} value={tpl.body} aria-describedby="e-body"
                  onFocus={() => { lastField.current = "body"; }} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} onBlur={() => blurTemplate("body")}
                />
                <FieldErrorText id="e-body" message={err("body")} />
              </div>
            </div>
            <div className={s.col}>
              <div className={s.lab} id={fid("ph-head")}>差込項目（クリックでカーソル位置に挿入）</div>
              <ul className={s.ph} aria-labelledby={fid("ph-head")} onKeyDown={listKeys}>
                {names.map((n, i) => (
                  <li key={n}>
                    <button
                      id={fid(`ph-${i}`)} type="button" tabIndex={i === Math.min(cursor, names.length - 1) ? 0 : -1} onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setCursor(i); insert(n); }}
                    >
                      <code>{`{{${n}}}`}</code><span>{PLACEHOLDERS[n]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className={s.col}>
              <div className={s.prevHead}>
                <span className={s.lab}>プレビュー（サンプルデータ）</span>
                <Button variant="secondary" onClick={() => void runPreview()}><Icon name="refresh" size={16} /> プレビュー</Button>
              </div>
              <div className={s.preview} aria-live="polite">
                {preview && (
                  <>
                    {preview.subject !== null && <div className={s.prevSubject}>件名: {preview.subject}</div>}
                    <div className={s.prevBody}>{preview.body}</div>
                    {preview.count !== null && <div className={over ? s.countOver : s.countOk}>{preview.count} / {SMS_LIMIT}文字</div>}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={s.actions}>
            <span className={s.help}>保存すると次回の送信から適用されます。</span>
            <span className={s.sp} />
            <Button busy={busy} onClick={() => void save()}>保存する</Button>
          </div>
        </section>
      ) : (
        <section className={s.card}>
          <div className={s.groups}>
            <div className={s.group}>
              <h2>枠</h2>
              {pfield("枠の長さ（分）", "frameMinutes", "1枠の時間。変更は枠が未生成の日から適用されます。", (
                <select id={fid("frameMinutes")} className={`inp ${s.short}`} value={pol.frameMinutes} onChange={(e) => setP({ frameMinutes: Number(e.target.value) })}>
                  {FRAME_MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ))}
              {pfield("1枠の定員", "frameCapacity", "同じ時刻に予約できる人数（1〜10）。以降に生成する枠に適用。", num("frameCapacity"))}
            </div>
            <div className={s.group}>
              <h2>受付期間</h2>
              {pfield("予約受付期間（日）", "bookingWindowDays", "何日先まで予約できるか（7〜180）。保存すると枠を再生成します。", num("bookingWindowDays"))}
              {pfield("当日予約の締切（開始の何分前）", "sameDayCutoffMinutes", "当日のWeb予約を締め切る時間（0〜240分）。スタッフ予約には適用しません。", num("sameDayCutoffMinutes"))}
            </div>
            <div className={s.group}>
              <h2>キャンセル・上限</h2>
              <fieldset className={s.f}>
                <legend className={s.lab}>変更・キャンセル期限の種類 <RequiredMark lang="ja" /></legend>
                <label className={s.row}>
                  <input type="radio" name="a04-deadline" checked={pol.cancelDeadlineType === "PREV_DAY_TIME"} onChange={() => setP({ cancelDeadlineType: "PREV_DAY_TIME" })} />
                  前日の指定時刻まで
                  <input
                    id={fid("cancelDeadlineTime")} aria-label="前日の時刻" className={`inp ${s.short}`} style={{ width: 80 }} value={pol.cancelDeadlineTime}
                    disabled={pol.cancelDeadlineType !== "PREV_DAY_TIME"} aria-describedby="e-cancelDeadlineTime"
                    onChange={(e) => setP({ cancelDeadlineTime: e.target.value })} onBlur={() => blurPolicy("cancelDeadlineTime")}
                  />
                </label>
                <label className={s.row}>
                  <input type="radio" name="a04-deadline" checked={pol.cancelDeadlineType === "HOURS_BEFORE"} onChange={() => setP({ cancelDeadlineType: "HOURS_BEFORE" })} />
                  開始の
                  <input
                    id={fid("cancelDeadlineHours")} aria-label="何時間前" className={`inp ${s.short}`} style={{ width: 60 }} inputMode="numeric" value={pol.cancelDeadlineHours}
                    disabled={pol.cancelDeadlineType !== "HOURS_BEFORE"} aria-describedby="e-cancelDeadlineHours"
                    onChange={(e) => setP({ cancelDeadlineHours: e.target.value })} onBlur={() => blurPolicy("cancelDeadlineHours")}
                  />
                  時間前まで
                </label>
                <div className={s.help}>期限を過ぎるとWebでは変更できず、電話案内（19）を表示します。</div>
                <FieldErrorText id="e-cancelDeadlineTime" message={err("cancelDeadlineTime")} />
                <FieldErrorText id="e-cancelDeadlineHours" message={err("cancelDeadlineHours")} />
              </fieldset>
              {pfield("1人1日あたりの予約上限", "perPersonDailyLimit", "同じ患者が1日に予約できる件数（1〜3）。スタッフは警告の上で超過可。", num("perPersonDailyLimit", 60))}
            </div>
            <div className={s.group}>
              <h2>リマインド</h2>
              {pfield("リマインド送信時刻（前日）", "reminderTime", "前日リマインド（NT-02）を送る時刻（07:00〜20:00）。", num("reminderTime"))}
            </div>
            <div className={`${s.group} ${s.wide}`}>
              <h2>電話案内</h2>
              <div className={s.lab}>期限後の電話案内文 <span className="req">必須（JA）</span></div>
              <div className={s.phones}>
                {(["phoneMessageJa", "phoneMessageEn", "phoneMessageVi"] as const).map((f, i) => (
                  <div key={f} className={s.f}>
                    <label htmlFor={fid(f)} className={s.tag}>{["JA", "EN", "VI"][i]}</label>
                    <textarea
                      id={fid(f)} className="inp" rows={3} value={pol[f]} aria-describedby={`e-${f}`}
                      onChange={(e) => setP({ [f]: e.target.value })} onBlur={() => blurPolicy(f)}
                    />
                    <FieldErrorText id={`e-${f}`} message={err(f)} />
                  </div>
                ))}
              </div>
              <div className={s.help}>患者画面で期限後に表示する文（PI051）。各300文字まで。</div>
            </div>
          </div>
          <div className={s.actions}>
            <span className={s.sp} />
            <Button busy={busy} onClick={() => void save()}>保存する</Button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.id === "SW061" ? "SMSが分割送信になります" : "枠の長さを変更しますか？"}
        messageId={dialog?.id ?? "SW061"}
        params={dialog?.params}
        onConfirm={() => save(true)}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
