"use client";

// spec-screen: A03
// The three edit forms (医師 5-16, 36 / 診療科 18-22 / 診療区分 24-32). Buttons 33-35 are the parent's.
import type { ReactNode } from "react";
import { FieldError, RequiredMark } from "@/components/ui/FormParts";
import { Icon } from "@/components/ui/Icon";
import type { DepartmentDetail, MasterLists } from "@/lib/admin/masters";
import { CATEGORIES, CATEGORY_LABEL, TITLES, TITLE_LABEL, type DepartmentValues, type DoctorValues, type VisitTypeValues } from "@/lib/admin/masters-rules";
import s from "./masters.module.css";

export type FormCtx<V> = {
  v: V;
  set: (patch: Partial<V>) => void;
  /** message under the field, null when it is fine */
  err: (field: string) => string | null;
  blur: (field: string) => void;
  /** state ① (reception) or ② (inactive record): every input read-only */
  ro: boolean;
  lists: MasterLists;
};

export const fid = (field: string) => `f-${field}`;

function Row({ label, req, badge, f, ctx, children }: { label: string; req?: boolean; badge?: string; f?: string; ctx: Pick<FormCtx<unknown>, "err">; children: ReactNode }) {
  return (
    <div className={s.f}>
      <div className={s.lab}>
        <label htmlFor={f ? fid(f) : undefined}>{label}</label>
        {req && <RequiredMark lang="ja" />}
        {badge && <span className={s.badge}>{badge}</span>}
      </div>
      <div>
        {children}
        {f && <FieldError id={`e-${f}`} message={ctx.err(f)} />}
      </div>
    </div>
  );
}

type TextProps<V> = { ctx: FormCtx<V>; f: keyof V & string; area?: boolean; className?: string; disabled?: boolean; placeholder?: string; maxLength?: number };
function Text<V>({ ctx, f, area, className, disabled, placeholder }: TextProps<V>) {
  const common = {
    id: fid(f), className: `inp ${className ?? ""}`, value: String(ctx.v[f] ?? ""), readOnly: ctx.ro, disabled, placeholder,
    "aria-invalid": ctx.err(f) ? true : undefined, "aria-describedby": ctx.err(f) ? `e-${f}` : undefined,
    onBlur: () => ctx.blur(f),
    onChange: (e: { target: { value: string } }) => ctx.set({ [f]: e.target.value } as Partial<V>),
  };
  return area ? <textarea {...common} rows={4} /> : <input type="text" {...common} />;
}

function Check({ checked, onChange, ro, children, id }: { checked: boolean; onChange: (v: boolean) => void; ro: boolean; children: ReactNode; id?: string }) {
  return (
    <label>
      <input id={id} type="checkbox" checked={checked} disabled={ro} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

const trio = <V,>(ctx: FormCtx<V>, a: keyof V & string, b: keyof V & string, c: keyof V & string, area = false) => (
  <div className={s.cols}>
    {[["JA", a], ["EN", b], ["VI (空欄 = JA を表示)", c]].map(([badge, f]) => (
      <div key={f}>
        <div className={s.badge}>{badge}</div>
        <Text ctx={ctx} f={f as keyof V & string} area={area} />
        <FieldError id={`e-${f}`} message={ctx.err(f)} />
      </div>
    ))}
  </div>
);

/** 11 / 21 / 13: the group is checked when focus leaves it, not on each box */
const leaving = (blur: () => void) => (e: React.FocusEvent) => {
  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) blur();
};

const select = <V,>(ctx: FormCtx<V>, f: keyof V & string, options: { id: string; label: string }[]) => (
  <select id={fid(f)} className="inp" value={String(ctx.v[f] ?? "")} disabled={ctx.ro} onChange={(e) => ctx.set({ [f]: e.target.value } as Partial<V>)} onBlur={() => ctx.blur(f)}>
    <option value="">選択してください</option>
    {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
  </select>
);

export type DoctorFormProps = FormCtx<DoctorValues> & { hasAccount: boolean; photo: ReactNode; photoError: string | null };

export function DoctorForm(ctx: DoctorFormProps) {
  const { v, set, lists, ro } = ctx;
  const departments = lists.choices.departments.filter((d) => d.isActive || v.departmentIds.includes(d.id));
  const toggle = (id: string, on: boolean) => set({ departmentIds: on ? [...v.departmentIds, id] : v.departmentIds.filter((x) => x !== id) });
  return (
    <>
      <Row label="医師コード" req f="code" ctx={ctx}><Text ctx={ctx} f="code" className="" /></Row>
      <Row label="姓 / 名" req ctx={ctx}>
        <div className={s.two}>
          <div><Text ctx={ctx} f="familyName" /><FieldError id="e-familyName" message={ctx.err("familyName")} /></div>
          <div><Text ctx={ctx} f="givenName" /><FieldError id="e-givenName" message={ctx.err("givenName")} /></div>
        </div>
      </Row>
      <Row label="セイ / メイ" req ctx={ctx}>
        <div className={s.two}>
          <div><Text ctx={ctx} f="familyNameKana" /><FieldError id="e-familyNameKana" message={ctx.err("familyNameKana")} /></div>
          <div><Text ctx={ctx} f="givenNameKana" /><FieldError id="e-givenNameKana" message={ctx.err("givenNameKana")} /></div>
        </div>
      </Row>
      <Row label="ローマ字氏名" req f="nameRomaji" ctx={ctx}><Text ctx={ctx} f="nameRomaji" /></Row>
      <Row label="役職" req f="title" ctx={ctx}>{select(ctx, "title", TITLES.map((t) => ({ id: t, label: TITLE_LABEL[t] })))}</Row>
      <Row label="写真" ctx={ctx}>
        {ctx.photo}
        <FieldError id="e-photo" message={ctx.photoError} />
      </Row>
      <Row label="診療科" req ctx={ctx}>
        <div className={s.checks} id={fid("departmentIds")} tabIndex={-1} onBlur={leaving(() => ctx.blur("departmentIds"))}>
          {departments.map((d) => (
            <Check key={d.id} ro={ro} checked={v.departmentIds.includes(d.id)} onChange={(on) => toggle(d.id, on)}>{d.nameJa}</Check>
          ))}
        </div>
        <FieldError id="e-departmentIds" message={ctx.err("departmentIds")} />
      </Row>
      <Row label="主な勤務クリニック" req f="primaryClinicId" ctx={ctx}>
        {select(ctx, "primaryClinicId", lists.choices.clinics.map((c) => ({ id: c.id, label: c.nameJa })))}
      </Row>
      <Row label="対応言語" req ctx={ctx}>
        <div className={s.checks} id={fid("languages")} tabIndex={-1} onBlur={leaving(() => ctx.blur("languages"))}>
          <Check ro={ro} checked={v.langJa} onChange={(x) => set({ langJa: x })}>日本語</Check>
          <Check ro={ro} checked={v.langEn} onChange={(x) => set({ langEn: x })}>英語</Check>
          <Check ro={ro} checked={v.langVi} onChange={(x) => set({ langVi: x })}>ベトナム語</Check>
          <label>その他 <Text ctx={ctx} f="langOther" className={s.small} placeholder="ISOコード" /></label>
        </div>
        <FieldError id="e-languages" message={ctx.err("languages")} />
        <FieldError id="e-langOther" message={ctx.err("langOther")} />
      </Row>
      <Row label="経歴" req badge="必須 (JA)" ctx={ctx}>{trio(ctx, "profileJa", "profileEn", "profileVi", true)}</Row>
      <Row label="資格・所属学会" ctx={ctx}>{trio(ctx, "qualJa", "qualEn", "qualVi", true)}</Row>
      <Row label="表示順" req f="displayOrder" ctx={ctx}><Text ctx={ctx} f="displayOrder" className={s.small} /></Row>
    </>
  );
}

export type DepartmentFormProps = FormCtx<DepartmentValues> & { isNew: boolean; links: DepartmentDetail["links"] };

export function DepartmentForm(ctx: DepartmentFormProps) {
  const { v, set, lists, ro } = ctx;
  return (
    <>
      <Row label="診療科コード" req f="code" ctx={ctx}>
        {/* 18 is editable only until the first save */}
        <Text ctx={{ ...ctx, ro: ctx.ro || !ctx.isNew }} f="code" />
        <span className={s.note}>初回保存後は変更不可（問診ブロックの選択に使用）</span>
      </Row>
      <Row label="診療科名" req badge="必須 (JA)" ctx={ctx}>
        <div className={s.cols}>
          {([["JA", "nameJa"], ["EN", "nameEn"], ["VI", "nameVi"]] as const).map(([b, f]) => (
            <div key={f}><div className={s.badge}>{b}</div><Text ctx={ctx} f={f} /><FieldError id={`e-${f}`} message={ctx.err(f)} /></div>
          ))}
        </div>
      </Row>
      <Row label="診療科名カナ" req f="nameKana" ctx={ctx}><Text ctx={ctx} f="nameKana" /></Row>
      <Row label="提供クリニック" ctx={ctx}>
        <div className={s.checks} id={fid("offered")} tabIndex={-1}>
          {lists.choices.clinics.map((c) => {
            const mine = c.id === lists.choices.clinicId;
            const link = ctx.links.find((l) => l.clinicId === c.id);
            return (
              <span key={c.id} className={s.clinicRow}>
                {/* only the CF-03 clinic is editable (Q2); the others show the stored row */}
                <Check ro={ro || !mine} checked={mine ? v.offered : !!link} onChange={(x) => set({ offered: x })}>{c.nameJa}</Check>
                {mine ? (
                  <input
                    id={fid("clinicOrder")} className={`inp ${s.small}`} value={v.clinicOrder} readOnly={ro} disabled={!v.offered}
                    aria-label={`${c.nameJa}の表示順`} onChange={(e) => set({ clinicOrder: e.target.value })} onBlur={() => ctx.blur("clinicOrder")}
                  />
                ) : (
                  <input className={`inp ${s.small}`} value={link ? String(link.displayOrder) : ""} readOnly disabled aria-label={`${c.nameJa}の表示順`} />
                )}
              </span>
            );
          })}
          <span className={s.note}>数字＝その院での表示順</span>
        </div>
        <FieldError id="e-offered" message={ctx.err("offered")} />
        <FieldError id="e-clinicOrder" message={ctx.err("clinicOrder")} />
      </Row>
      <Row label="表示順" req f="displayOrder" ctx={ctx}><Text ctx={ctx} f="displayOrder" className={s.small} /></Row>
    </>
  );
}

export function VisitTypeForm(ctx: FormCtx<VisitTypeValues> & { storedDepartmentId: string }) {
  const { v, set, lists, ro } = ctx;
  const offered = lists.choices.offeredDepartmentIds;
  const options = lists.choices.departments
    .filter((d) => (offered.includes(d.id) && d.isActive) || d.id === ctx.storedDepartmentId)
    .sort((a, b) => offered.indexOf(a.id) - offered.indexOf(b.id))
    .map((d) => ({ id: d.id, label: d.nameJa }));
  const frames = /^[1-8]$/.test(v.durationFrames.trim()) ? Number(v.durationFrames) : null;
  const m = lists.choices.frameMinutes;
  const selfPay = v.category === "SELF_PAY";
  return (
    <>
      <Row label="診療科" req f="departmentId" ctx={ctx}>{select(ctx, "departmentId", options)}</Row>
      <Row label="区分コード" req f="code" ctx={ctx}><Text ctx={ctx} f="code" /></Row>
      <Row label="区分" req ctx={ctx}>
        <div className={s.checks} role="radiogroup" id={fid("category")} tabIndex={-1}>
          {CATEGORIES.map((c) => (
            <label key={c}>
              <input
                type="radio" name="category" checked={v.category === c} disabled={ro}
                onChange={() => set({ category: c, ...(c === "SELF_PAY" ? {} : { priceYen: "" }) })}
              />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
        <FieldError id="e-category" message={ctx.err("category")} />
      </Row>
      <Row label="名称" req badge="必須 (JA)" ctx={ctx}>
        <div className={s.cols}>
          {([["JA", "nameJa"], ["EN", "nameEn"], ["VI", "nameVi"]] as const).map(([b, f]) => (
            <div key={f}><div className={s.badge}>{b}</div><Text ctx={ctx} f={f} /><FieldError id={`e-${f}`} message={ctx.err(f)} /></div>
          ))}
        </div>
      </Row>
      <Row label="所要枠数" req f="durationFrames" ctx={ctx}>
        <div className="row">
          <Text ctx={ctx} f="durationFrames" className={s.small} />
          {frames !== null && <span>枠＝{frames * m}分（1枠{m}分）</span>}
          <span className={s.note}>変更は新規予約から適用</span>
        </div>
      </Row>
      <Row label="料金（税込）" f="priceYen" ctx={ctx}>
        <div className="row">
          <Text ctx={ctx} f="priceYen" className={s.small} disabled={!selfPay} />円
          <span className={s.note}>自費のみ入力可（初診・再診は無効）</span>
        </div>
      </Row>
      <Row label="Web予約可" ctx={ctx}>
        <div className={s.checks}><Check id={fid("webBookable")} ro={ro} checked={v.webBookable} onChange={(x) => set({ webBookable: x })}>Webで予約できる（外すとスタッフ専用・S02のみ）</Check></div>
      </Row>
      <Row label="患者向け案内" ctx={ctx}>{trio(ctx, "noticeJa", "noticeEn", "noticeVi", true)}</Row>
      <Row label="表示順" req f="displayOrder" ctx={ctx}><Text ctx={ctx} f="displayOrder" className={s.small} /></Row>
    </>
  );
}

export const Silhouette = () => <Icon name="user" size={36} />;
