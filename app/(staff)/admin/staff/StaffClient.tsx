"use client";

// spec-screen: A05
// スタッフアカウント管理: list left, form right. States: 基 / ① new / ② disabled / ③ locked / ④ role 医師 / ⑤ password dialog /
// ⑥ SW070 / ⑦ own account / ⑧ viewer without all_clinics. The password of a new or reissued account is held only in the dialog.
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, trapTab } from "@/components/ui/ConfirmDialog";
import { ErrorSummary, FieldError as FieldErrorText, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import type { StaffDetail, StaffLists, StaffRow } from "@/lib/admin/staff";
import { ROLE_LABEL, STAFF_ROLES, validateStaff, type AccountState, type StaffValues } from "@/lib/admin/staff-rules";
import type { FieldError } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import s from "./staff.module.css";

type Answer = {
  code?: string; params?: Record<string, string | number>; errors?: FieldError[]; id?: string; password?: string;
  detail?: StaffDetail; lists?: StaffLists; unchanged?: boolean;
};
type Cur = { id: string | null; vals: StaffValues; detail: StaffDetail | null };

const URL = {
  list: "/api/admin/staff/list", detail: "/api/admin/staff/detail", save: "/api/admin/staff/save", password: "/api/admin/staff/password",
  disable: "/api/admin/staff/disable", enable: "/api/admin/staff/enable", unlock: "/api/admin/staff/unlock",
};
const BLANK: StaffValues = { displayName: "", email: "", role: "", clinicIds: [], allClinics: false, doctorId: "" };
const fid = (f: string) => `s-${f}`;

const stateText = (state: AccountState, hhmm: string | null) =>
  state === "disabled" ? "無効" : state === "locked" ? `ロック中（${hhmm}まで）` : state === "firstChange" ? "初回パスワード変更待ち" : "有効";
const pillClass = (state: AccountState) => `${s.pill} ${state === "disabled" ? s.pillOff : state === "active" ? "" : s.pillWarn}`;

export function StaffClient({ lists: initialLists, initial }: { lists: StaffLists; initial: StaffDetail | null }) {
  const { toast } = useToast();
  const api = useApiFetch();
  const [lists, setLists] = useState(initialLists);
  const [filter, setFilter] = useState({ role: "", state: "" });
  const [cur, setCur] = useState<Cur | null>(initial ? { id: initial.id, vals: initial, detail: initial } : null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [password, setPassword] = useState<{ value: string; message: "SI070" | "SI073" } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);

  async function call(url: string, init?: RequestInit) {
    const res = await api(url, init);
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, json: (await res.json().catch(() => ({}))) as Answer };
  }
  const clear = () => {
    setErrors([]);
    setBanner(null);
  };
  const bannerOf = (j: Answer) => setBanner(t(j.code ?? "SE090", "ja", j.params));

  const visible = (rows: StaffRow[], f = filter) =>
    rows.filter(
      (r) => (!f.role || r.role === f.role)
        && (!f.state || (f.state === "active" ? r.state === "active" || r.state === "firstChange" : r.state === f.state)),
    );
  const rows = visible(lists.rows);

  async function open(id: string | null) {
    clear();
    if (!id) return setCur(null);
    const r = await call(`${URL.detail}?id=${id}`);
    if (r?.ok) setCur({ id, vals: r.json.detail!, detail: r.json.detail! });
  }
  async function reload() {
    const r = await call(URL.list);
    if (!r?.ok) return lists;
    setLists(r.json.lists!);
    return r.json.lists!;
  }
  function changeFilter(patch: Partial<typeof filter>) {
    const next = { ...filter, ...patch };
    setFilter(next);
    const shown = visible(lists.rows, next);
    if (cur?.id && !shown.some((r) => r.id === cur.id)) void open(shown[0]?.id ?? null);
  }

  // ── the form ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const isNew = cur !== null && cur.id === null;
  const d = cur?.detail ?? null;
  const own = d?.own ?? false;
  const ro = !isNew && (d?.state === "disabled" || d?.locked8 === true);
  const set = (p: Partial<StaffValues>) => cur && setCur({ ...cur, vals: { ...cur.vals, ...p } });
  const err = (f: string) => {
    const e = errors.find((x) => x.field === f);
    return e ? t(e.code, "ja", e.params) : null;
  };
  const blur = (f: string) => {
    if (!cur) return;
    const found = validateStaff(cur.vals).filter((e) => e.field === f);
    setErrors((prev) => [...prev.filter((e) => e.field !== f), ...found]);
  };
  const leaving = (f: string) => (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) blur(f);
  };

  /** event 4: the clinic, all-clinics and doctor items follow the role */
  function chooseRole(role: string) {
    if (!cur) return;
    set({ role, ...(role !== "ADMIN" ? { allClinics: false } : {}), ...(role !== "DOCTOR" ? { doctorId: "" } : {}) });
  }

  async function save() {
    if (!cur) return;
    clear();
    const vals = cur.vals.role === "DOCTOR" ? { ...cur.vals, clinicIds: [] } : cur.vals;
    const local = validateStaff(vals);
    if (local.length > 0) {
      setErrors(local);
      document.getElementById(fid(local[0].field))?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await call(...postJson(URL.save, { ...vals, id: cur.id ?? undefined }));
      if (!r) return;
      if (!r.ok) return r.json.errors ? setErrors(r.json.errors) : bannerOf(r.json);
      if (r.json.password) setPassword({ value: r.json.password, message: "SI070" });
      else toast("SI074");
      await reload();
      await open(r.json.id ?? null);
    } finally {
      setBusy(false);
    }
  }

  /** events 7, 9, 10 (and 8 after the dialog) */
  async function act(url: string, after: (j: Answer) => void) {
    if (!cur?.id) return;
    clear();
    const r = await call(...postJson(url, { id: cur.id }));
    setConfirmDisable(false);
    if (!r) return;
    if (!r.ok) return bannerOf(r.json);
    after(r.json);
    await reload();
    await open(cur.id);
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setCursor(Math.min(cursor + 1, rows.length - 1));
    else if (e.key === "ArrowUp") setCursor(Math.max(cursor - 1, 0));
    else if (e.key === "Enter" && rows[cursor]) void open(rows[cursor].id);
    else return;
    e.preventDefault();
  };

  const role = cur?.vals.role ?? "";
  const doctorOptions = [...(d?.linkedDoctor ? [{ ...d.linkedDoctor, suffix: "" }] : []), ...lists.doctors.map((x) => ({ ...x, suffix: "（アカウントなし）" }))];

  function field(label: string, f: string, control: React.ReactNode, req = true) {
    return (
      <div className={s.f}>
        <div className={s.lab}><label htmlFor={fid(f)}>{label}</label>{req && <RequiredMark lang="ja" />}</div>
        {control}
        <FieldErrorText id={`e-${f}`} message={err(f)} />
      </div>
    );
  }

  function renderForm() {
    if (!cur) return null;
    const summary = errors.map((e) => ({ fieldId: fid(e.field), message: t(e.code, "ja", e.params) }));
    return (
      <div className={s.form}>
        {!isNew && <h2>アカウントの編集</h2>}
        {banner && <div className="err" role="alert"><Icon name="alert" /> {banner}</div>}
        <ErrorSummary errors={summary} lang="ja" />
        {!isNew && d && (
          <div className="row"><span className={s.lab}>状態</span><span className={pillClass(d.state)}>{stateText(d.state, d.lockedHhmm)}</span></div>
        )}
        {field("表示名", "displayName", (
          <input id={fid("displayName")} className="inp" value={cur.vals.displayName} readOnly={ro} onChange={(e) => set({ displayName: e.target.value })} onBlur={() => blur("displayName")} />
        ))}
        {field("メールアドレス", "email", (
          <input id={fid("email")} className="inp" value={cur.vals.email} readOnly={ro} onChange={(e) => set({ email: e.target.value })} onBlur={() => blur("email")} />
        ))}
        {field("ロール", "role", (
          <div className={s.checks} role="radiogroup" id={fid("role")} tabIndex={-1} onBlur={leaving("role")}>
            {STAFF_ROLES.map((r) => (
              <label key={r}>
                <input type="radio" name="role" checked={role === r} disabled={ro || own} onChange={() => chooseRole(r)} />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        ))}
        {role !== "DOCTOR" && field("担当クリニック", "clinicIds", (
          <div className={s.checks} id={fid("clinicIds")} tabIndex={-1} onBlur={leaving("clinicIds")}>
            {lists.clinics.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox" checked={cur.vals.clinicIds.includes(c.id)} disabled={ro || own}
                  onChange={(e) => set({ clinicIds: e.target.checked ? [...cur.vals.clinicIds, c.id] : cur.vals.clinicIds.filter((x) => x !== c.id) })}
                />
                {c.nameJa}
              </label>
            ))}
          </div>
        ), true)}
        {role !== "DOCTOR" && lists.viewerAllClinics && (
          <div className={s.f}>
            <label className={s.checks}>
              <input
                id={fid("allClinics")} type="checkbox" checked={role === "ADMIN" && cur.vals.allClinics}
                disabled={ro || own || role !== "ADMIN"} onChange={(e) => set({ allClinics: e.target.checked })}
              />
              全クリニック管理者{role !== "ADMIN" && <span className={s.note}>（管理者ロールのみ）</span>}
            </label>
          </div>
        )}
        <div className={s.note}>ロールを変更すると、このアカウントのログインはすべて終了します。自分のロールは変更できません。</div>
        {role === "DOCTOR" && field("紐付ける医師", "doctorId", (
          <select id={fid("doctorId")} className="inp" value={cur.vals.doctorId} disabled={ro} onChange={(e) => set({ doctorId: e.target.value })} onBlur={() => blur("doctorId")}>
            <option value="">選択してください</option>
            {doctorOptions.map((o) => <option key={o.id} value={o.id}>{o.label}{o.suffix}</option>)}
          </select>
        ))}
        <div className={s.actions}>
          {!ro && <Button busy={busy} onClick={() => void save()}>保存する</Button>}
          <span className="sp" />
          {!ro && !isNew && !own && <Button variant="secondary" onClick={() => void act(URL.password, (j) => setPassword({ value: j.password!, message: "SI073" }))}><Icon name="lock" size={16} />パスワード発行</Button>}
          {!ro && !isNew && <Button variant="danger" onClick={() => (own ? void act(URL.disable, () => undefined) : setConfirmDisable(true))}>無効化する</Button>}
          {!isNew && d?.state === "disabled" && !d.locked8 && <Button onClick={() => void act(URL.enable, () => toast("SI071"))}>有効化する</Button>}
          {!isNew && d?.state === "locked" && !d.locked8 && <Button variant="secondary" onClick={() => void act(URL.unlock, () => toast("SI072"))}>ロック解除</Button>}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={s.top}>
        <h1 className={s.h1}>スタッフアカウント</h1>
        <Button className="btn-sm" onClick={() => { clear(); setCur({ id: null, vals: { ...BLANK }, detail: null }); }}><Icon name="plus" size={16} />新規作成</Button>
      </div>
      <div className={s.split}>
        <div>
          <div className={s.filters}>
            <label>ロール:
              <select value={filter.role} onChange={(e) => changeFilter({ role: e.target.value })}>
                <option value="">すべて</option>
                {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label>状態:
              <select value={filter.state} onChange={(e) => changeFilter({ state: e.target.value })}>
                <option value="">すべて</option><option value="active">有効</option><option value="locked">ロック中</option><option value="disabled">無効</option>
              </select>
            </label>
          </div>
          <div className={s.list} tabIndex={0} role="grid" aria-label="アカウント一覧" onKeyDown={keys}>
            <table className={s.table}>
              <thead><tr>{["表示名", "メールアドレス", "ロール", "状態", "担当クリニック", "最終ログイン"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id} data-row aria-selected={cur?.id === r.id} className={`${cur?.id === r.id ? s.sel : ""} ${r.state === "disabled" ? s.off : ""}`}
                    onClick={() => { setCursor(i); void open(r.id); }}
                  >
                    <td>{r.displayName}</td><td>{r.email}</td><td><span className={s.badge}>{ROLE_LABEL[r.role]}</span></td>
                    <td><span className={pillClass(r.state)}>{stateText(r.state, r.lockedHhmm)}</span></td><td>{r.clinics}</td><td>{r.lastLogin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {renderForm()}
      </div>
      {password && (
        <div className="scrim-fixed" onKeyDown={trapTab}>
          <div className="dlg" role="alertdialog" aria-modal="true" aria-labelledby="pw-title">
            <h3 id="pw-title">初期パスワードを発行しました</h3>
            <div className={s.pw} data-testid="initial-password">{password.value}</div>
            <div className={s.warn}><Icon name="alert" /><span>{t(password.message, "ja", { パスワード: password.value })}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(password.value)}>コピー</Button>
              {/* the only way out: no ×, Esc and a click outside do nothing (Q2 b) */}
              <Button autoFocus onClick={() => setPassword(null)}>確認して閉じる</Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDisable} title="アカウントを無効化しますか？" messageId="SW070" confirmLabel="無効化する" destructive
        onConfirm={() => act(URL.disable, () => undefined)} onCancel={() => setConfirmDisable(false)}
      />
    </>
  );
}
