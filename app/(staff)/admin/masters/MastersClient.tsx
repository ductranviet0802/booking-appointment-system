"use client";

// spec-screen: A03
// 医師・診療科・診療区分マスタ: three tabs, list left, form right. State 基 (ADMIN), ① (RECEPTION: read-only, no action buttons),
// ② (inactive record: read-only except 有効化する), ③ (new). Edits live on the page until 保存する (Q15 c).
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorSummary } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import type {
  DepartmentDetail, DoctorDetail, MasterDetail, MasterLists, VisitTypeDetail,
} from "@/lib/admin/masters";
import {
  CATEGORY_LABEL, KIND_LABEL, TITLE_LABEL, validateDepartment, validateDoctor, validateVisitType,
  type DepartmentValues, type DoctorValues, type Kind, type VisitTypeValues,
} from "@/lib/admin/masters-rules";
import type { FieldError } from "@/lib/auth/validate";
import { openStaffErrorScreen, postJson, useApiFetch } from "@/lib/client/api";
import { t } from "@/lib/i18n";
import { DepartmentForm, DoctorForm, fid, Silhouette, VisitTypeForm } from "./MasterForms";
import s from "./masters.module.css";

type Role = "ADMIN" | "RECEPTION";
type Values = DoctorValues | DepartmentValues | VisitTypeValues;
type Held = { id: string | null; isActive: boolean; vals: Values; extra: Partial<DoctorDetail & DepartmentDetail & VisitTypeDetail> };

type Answer = {
  code?: string; params?: Record<string, string | number>; errors?: FieldError[]; id?: string; detail?: MasterDetail; lists?: MasterLists;
  photoUrl?: string; unchanged?: boolean;
};

const TABS:{ kind: Kind; label: string }[] = [
  { kind: "doctor", label: "医師" }, { kind: "department", label: "診療科" }, { kind: "visitType", label: "診療区分" },
];
const ENDPOINT = { list: "/api/admin/masters/list", detail: "/api/admin/masters/detail", save: "/api/admin/masters/save", status: "/api/admin/masters/status", del: "/api/admin/masters/delete", photo: "/api/admin/photos" };

const blankDoctor: DoctorValues = {
  code: "", familyName: "", givenName: "", familyNameKana: "", givenNameKana: "", nameRomaji: "", title: "", photoUrl: null,
  departmentIds: [], primaryClinicId: "", langJa: true, langEn: false, langVi: false, langOther: "",
  profileJa: "", profileEn: "", profileVi: "", qualJa: "", qualEn: "", qualVi: "", displayOrder: "",
};
const blankDepartment: DepartmentValues = { code: "", nameJa: "", nameEn: "", nameVi: "", nameKana: "", displayOrder: "", offered: false, clinicOrder: "" };
const blankVisitType: VisitTypeValues = {
  departmentId: "", code: "", category: "", nameJa: "", nameEn: "", nameVi: "", durationFrames: "", priceYen: "", webBookable: true,
  noticeJa: "", noticeEn: "", noticeVi: "", displayOrder: "",
};
const BLANK = { doctor: blankDoctor, department: blankDepartment, visitType: blankVisitType };

const held = (d: MasterDetail): Held => ({ id: d.id, isActive: d.isActive, vals: d, extra: d });
const fresh = (kind: Kind): Held => ({ id: null, isActive: true, vals: { ...BLANK[kind] }, extra: {} });

const rowsOf = (lists: MasterLists, kind: Kind, activeOnly: boolean) =>
  (kind === "doctor" ? lists.doctors : kind === "department" ? lists.departments : lists.visitTypes).filter((r) => !activeOnly || r.isActive);

export function MastersClient({ role, lists: initialLists, initial }: { role: Role; lists: MasterLists; initial: DoctorDetail | null }) {
  const { toast } = useToast();
  const api = useApiFetch();
  const [lists, setLists] = useState(initialLists);
  const [tab, setTab] = useState<Kind>("doctor");
  const [activeOnly, setActiveOnly] = useState<Record<Kind, boolean>>({ doctor: true, department: true, visitType: true });
  const [cur, setCur] = useState<Held | null>(initial ? held(initial) : null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<"deactivate" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const admin = role === "ADMIN";

  /** an answer; null when the request failed or an error screen opened (401 / 403 / SE090 / 5xx) */
  async function call(url: string, init?: RequestInit) {
    const res = await api(url, init);
    if (!res || (await openStaffErrorScreen(res))) return null;
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Answer };
  }

  function clearMessages() {
    setErrors([]);
    setBanner(null);
    setPhotoError(null);
  }

  /** event 2: the record is read again from the server */
  async function open(kind: Kind, id: string | null) {
    clearMessages();
    if (!id) return setCur(null);
    const r = await call(`${ENDPOINT.detail}?kind=${kind}&id=${id}`);
    if (r?.ok) setCur(held(r.json.detail!));
  }

  async function reload() {
    const r = await call(ENDPOINT.list);
    if (!r?.ok) return lists;
    setLists(r.json.lists!);
    return r.json.lists!;
  }

  function switchTab(kind: Kind) {
    const only = { ...activeOnly, [kind]: true };
    setTab(kind);
    setActiveOnly(only);
    setCursor(0);
    setCur(null);
    void open(kind, rowsOf(lists, kind, true)[0]?.id ?? null);
  }

  function toggleActiveOnly(on: boolean) {
    setActiveOnly({ ...activeOnly, [tab]: on });
    const rows = rowsOf(lists, tab, on);
    if (cur?.id && !rows.some((r) => r.id === cur.id)) void open(tab, rows[0]?.id ?? null);
  }

  function newRecord() {
    clearMessages();
    setCur(fresh(tab));
  }

  // ── form state ───────────────────────────────────────────────────────────────────────────────────────────────────
  const isNew = cur !== null && cur.id === null;
  const ro = !admin || !cur?.isActive;
  const set = (patch: Partial<Values>) => cur && setCur({ ...cur, vals: { ...cur.vals, ...patch } as Values });
  const messageOf = (e: FieldError) => t(e.code, "ja", e.params);
  const err = (field: string) => {
    const e = errors.find((x) => x.field === field);
    return e ? messageOf(e) : null;
  };

  function validate(): FieldError[] {
    if (!cur) return [];
    if (tab === "doctor") return validateDoctor(cur.vals as DoctorValues);
    if (tab === "department") return validateDepartment(cur.vals as DepartmentValues, isNew);
    return validateVisitType(cur.vals as VisitTypeValues, false);
  }

  /** event 3: the field that was left is checked (server-only rules SE051 / SE052 / SE054 stay for event 5) */
  function blur(field: string) {
    const found = validate().filter((e) => e.field === field);
    setErrors((prev) => [...prev.filter((e) => e.field !== field), ...found]);
  }

  // ── events 5-11 ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function save() {
    if (!cur) return;
    clearMessages();
    const local = validate();
    if (local.length > 0) {
      setErrors(local);
      document.getElementById(fid(local[0].field))?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await call(...postJson(ENDPOINT.save, { ...cur.vals, kind: tab, id: cur.id ?? undefined }));
      if (!r) return;
      if (r.ok) {
        toast("SI050");
        await reload();
        await open(tab, r.json.id ?? null);
      } else if (r.json.errors) setErrors(r.json.errors);
      else setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(active: boolean) {
    if (!cur?.id) return;
    const r = await call(...postJson(ENDPOINT.status, { kind: tab, id: cur.id, active }));
    setDlg(null);
    if (!r) return;
    if (r.ok && !r.json.unchanged) toast("SI050");
    await reload();
    await open(tab, cur.id);
  }

  /** events 7 / 8: the check first (SE050 banner, no dialog), then the dialog, then はい */
  async function askDelete() {
    if (!cur?.id) return;
    clearMessages();
    const r = await call(...postJson(ENDPOINT.del, { kind: tab, id: cur.id, confirmed: false }));
    if (!r) return;
    if (r.ok) setDlg("delete");
    else setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
  }

  async function doDelete() {
    if (!cur?.id) return;
    const r = await call(...postJson(ENDPOINT.del, { kind: tab, id: cur.id, confirmed: true }));
    setDlg(null);
    if (!r) return;
    if (!r.ok) return setBanner(t(r.json.code ?? "SE090", "ja", r.json.params));
    toast("SI050");
    const next = await reload();
    await open(tab, rowsOf(next, tab, activeOnly[tab])[0]?.id ?? null);
  }

  /** event 9: the raw file goes to the server (type by content, size, crop, 400 px); the address is saved with 保存する */
  async function upload(file: File) {
    setPhotoError(null);
    const r = await call(ENDPOINT.photo, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    if (!r) return;
    if (r.ok) set({ photoUrl: r.json.photoUrl } as Partial<DoctorValues>);
    else setPhotoError(t("SE053", "ja"));
  }

  // ── lists ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const rows = rowsOf(lists, tab, activeOnly[tab]);
  const nameOf = (r: { nameJa?: string; familyName?: string; givenName?: string; isActive: boolean }) =>
    `${r.nameJa ?? `${r.familyName} ${r.givenName}`}${r.isActive ? "" : "（無効）"}`;

  function listKeys(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") setCursor(Math.min(cursor + 1, rows.length - 1));
    else if (e.key === "ArrowUp") setCursor(Math.max(cursor - 1, 0));
    else if (e.key === "Enter" && rows[cursor]) void open(tab, rows[cursor].id);
    else return;
    e.preventDefault();
  }

  function renderList() {
    const head = tab === "doctor" ? ["表示順", "コード", "氏名", "役職", "主な勤務"] : tab === "department" ? ["表示順", "コード", "診療科名", "提供クリニック"] : ["診療科", "コード", "名称", "区分", "料金", "Web"];
    return (
      <div className={s.list} tabIndex={0} role="grid" aria-label={`${KIND_LABEL[tab]}一覧`} onKeyDown={listKeys}>
        <table className={s.table}>
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const cells =
                tab === "doctor" ? (() => { const d = r as (typeof lists.doctors)[number]; return [d.displayOrder, d.code, nameOf(d), TITLE_LABEL[d.title], d.clinicName]; })()
                : tab === "department" ? (() => { const d = r as (typeof lists.departments)[number]; return [d.displayOrder, d.code, nameOf(d), d.clinicNames.join("・") || "—"]; })()
                : (() => { const d = r as (typeof lists.visitTypes)[number]; return [d.departmentName, d.code, nameOf(d), CATEGORY_LABEL[d.category], d.priceYen === null ? "—" : `${d.priceYen.toLocaleString("ja-JP")}円`, d.webBookable ? "○" : "—"]; })();
              return (
                <tr
                  key={r.id} data-row aria-selected={cur?.id === r.id}
                  className={`${cur?.id === r.id ? s.sel : ""} ${r.isActive ? "" : s.off}`}
                  onClick={() => { setCursor(i); void open(tab, r.id); }}
                >
                  {cells.map((c, j) => <td key={j}>{c}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {tab === "doctor" && rows.length > 0 && <div className={s.foot}>…{rows.length}名</div>}
      </div>
    );
  }

  // ── the form ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function renderForm() {
    if (!cur) return null;
    const ctx = { set, err, blur, ro, lists } as const;
    const heading = isNew ? "" : tab === "doctor" ? `${(cur.vals as DoctorValues).familyName} ${(cur.vals as DoctorValues).givenName}` : (cur.vals as DepartmentValues).nameJa;
    const summary = errors.filter((e) => e.field !== "photo").map((e) => ({ fieldId: fid(e.field), message: messageOf(e) }));
    const photo = tab === "doctor" && (() => {
      const v = cur.vals as DoctorValues;
      return (
        <div className={s.photo}>
          {/* a 400 px stored file: next/image optimisation adds nothing here */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className={s.round}>{v.photoUrl ? <img src={v.photoUrl} alt="" /> : <Silhouette />}</div>
          {!ro && (
            <>
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>画像を変更</Button>
              {v.photoUrl && <Button variant="secondary" onClick={() => set({ photoUrl: null } as Partial<DoctorValues>)}>削除</Button>}
              <input
                ref={fileRef} type="file" accept="image/jpeg,image/png" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }}
              />
            </>
          )}
          <div className={s.note}>JPEG / PNG・2MBまで。正方形に切り抜き400pxに縮小。未設定はシルエットを表示。</div>
        </div>
      );
    })();
    return (
      <div className={s.form}>
        <div className={s.head}>
          <h2>{heading}</h2>
          {tab === "doctor" && <span className="sm">ログインアカウント: <b>{cur.extra.hasAccount ? "あり" : "なし"}</b> <span className="mut xs">（A05 で紐付け）</span></span>}
        </div>
        {banner && <div className="err" role="alert"><Icon name="alert" /> {banner}</div>}
        <ErrorSummary errors={summary} lang="ja" />
        {tab === "doctor" && <DoctorForm {...ctx} v={cur.vals as DoctorValues} hasAccount={!!cur.extra.hasAccount} photo={photo} photoError={photoError} />}
        {tab === "department" && <DepartmentForm {...ctx} v={cur.vals as DepartmentValues} isNew={isNew} links={cur.extra.links ?? []} />}
        {tab === "visitType" && <VisitTypeForm {...ctx} v={cur.vals as VisitTypeValues} storedDepartmentId={cur.extra.departmentId ?? ""} />}
        {admin && (
          <div className={s.actions}>
            {!isNew && cur.isActive && <Button variant="danger" onClick={() => void askDelete()}>削除する</Button>}
            {!isNew && cur.isActive && <Button variant="danger" onClick={() => setDlg("deactivate")}>無効化する</Button>}
            {!isNew && !cur.isActive && <Button variant="secondary" onClick={() => void setActive(true)}>有効化する</Button>}
            <span className="sp" />
            {cur.isActive && <Button busy={busy} onClick={() => void save()}>保存する</Button>}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <h1 className={s.h1}>マスタ管理</h1>
      <div className={s.tabs} role="tablist" aria-label="マスタ">
        {TABS.map((x, i) => (
          <button
            key={x.kind} type="button" role="tab" aria-selected={tab === x.kind} tabIndex={tab === x.kind ? 0 : -1}
            className={`${s.tab} ${tab === x.kind ? s.tabOn : ""}`} onClick={() => switchTab(x.kind)}
            onKeyDown={(e) => {
              const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
              if (n !== null && TABS[(n + 3) % 3]) switchTab(TABS[(n + 3) % 3].kind);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className={s.split}>
        <div>
          <div className={s.bar}>
            <label className="row">
              <input type="checkbox" checked={activeOnly[tab]} onChange={(e) => toggleActiveOnly(e.target.checked)} />
              有効のみ表示
            </label>
            {admin && <Button className="btn-sm" onClick={newRecord}><Icon name="plus" size={16} />新規追加</Button>}
          </div>
          {renderList()}
        </div>
        {renderForm()}
      </div>
      <ConfirmDialog
        open={dlg === "deactivate"} title="無効化しますか？" messageId="SW050" params={{ 項目: KIND_LABEL[tab] }}
        confirmLabel="無効化する" destructive onConfirm={() => setActive(false)} onCancel={() => setDlg(null)}
      />
      <ConfirmDialog
        open={dlg === "delete"} title="削除しますか？" messageId="SW052" params={{ 項目: KIND_LABEL[tab] }}
        confirmLabel="削除する" destructive onConfirm={doDelete} onCancel={() => setDlg(null)}
      />
    </>
  );
}
