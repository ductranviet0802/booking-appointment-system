"use client";

// spec-screen: P07
// 家族管理: lead (23 / 23-1), empty state (1), member cards (2, 2-1…2-6) with この家族で予約 (3) / 編集 (4) / 削除 (5),
// 家族を追加する (6), the form (7–22; desktop right column, mobile full-screen sheet), PE043 / PE046 banner (Q9 A),
// PW004 dialog. Every write goes to /api/mypage/family/* where the server checks the ownership (F8-01).
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { postJson, useApiFetch } from "@/lib/client/api";
import { checkCardNo, checkPerson } from "@/lib/auth/validate";
import type { FieldError as ServerError } from "@/lib/auth/validate";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import type { LabelKey } from "@/lib/i18n/labels";
import type { loadFamily } from "@/lib/patient/family";
import { ErrorSummary, Field, fieldId, filled, invalid, useFatal, useFieldErrors } from "./form";
import { AddressFields, BirthSexFields, NameFields, PERSON_LABELS, personOf } from "./PersonFields";
import type { Values } from "./PersonFields";

export type FamilyData = Awaited<ReturnType<typeof loadFamily>>;
type Member = FamilyData["members"][number];
type CardRow = { clinicId: string; cardNo: string; confirmed: boolean };

const FORM = "p07";
const RELATIONS = ["CHILD", "SPOUSE", "PARENT", "OTHER"] as const;
const cardKey = (id: string) => `card:${id}`;
// F17-05: 保存する needs items 7–15 and 17
const REQUIRED = ["relation", "nameType", "familyName", "givenName", "familyNameKana", "givenNameKana", "bY", "bM", "bD", "sex", "postcode", "prefecture", "city", "addressLine"];

/** 2-3: ja 姓 名; en / vi given family for romaji names (04 §6.1) */
export const memberName = (m: { nameType: string; familyName: string; givenName: string }, lang: Lang) =>
  m.nameType === "ROMAJI" && lang !== "ja" ? `${m.givenName} ${m.familyName}` : `${m.familyName} ${m.givenName}`;
const born = (iso: string, lang: Lang) => {
  const [y, m, d] = iso.split("-").map(Number);
  return label("bornOn", lang, { y, m, d });
};

export function FamilyManager({ lang, data }: { lang: Lang; data: FamilyData }) {
  const router = useRouter();
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const fatal = useFatal();
  const [gone, setGone] = useState(false);
  const [form, setForm] = useState<null | { id: string | null }>(null);
  const [v, setV] = useState<Values>({});
  const [cards, setCards] = useState<CardRow[]>([]);
  const [banner, setBanner] = useState<"PE043" | "PE046" | null>(null);
  const [del, setDel] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Values) => setV((p) => ({ ...p, ...patch }));
  const clinicName = (id: string) => data.clinics.find((c) => c.clinicId === id)?.name ?? "";

  const names = useMemo(() => {
    const n: Record<string, LabelKey> = { ...PERSON_LABELS, relation: "relation" };
    for (const c of data.clinics) n[cardKey(c.clinicId)] = "cardNo";
    return n;
  }, [data.clinics]);
  const body = useCallback(() => ({
    ...personOf(v), relation: v.relation ?? "", ...(form?.id && { patientId: form.id }),
    cards: cards.filter((c) => !c.confirmed).map((c) => ({ clinicId: c.clinicId, cardNo: v[cardKey(c.clinicId)] ?? "" })),
  }), [v, cards, form]);
  const check = useCallback((): ServerError[] => {
    const b = body();
    const errors: ServerError[] = b.relation ? [] : [{ field: "relation", code: "PE001" }];
    errors.push(...(checkPerson(b, new Date(), false)?.errors ?? []));
    for (const c of b.cards) {
      const e = checkCardNo(c.cardNo, cardKey(c.clinicId));
      if (e) errors.push(e);
    }
    return errors;
  }, [body]);
  const fe = useFieldErrors(FORM, names, lang, check);
  const err = (f: string) => fe.textOf(f);
  const id = (f: string) => fieldId(FORM, f);

  if (gone) notFound(); // 3-2 / 6-6 / 7-3 / 9-4: not a member of the own account (any more) → ER-01

  /** the answers that leave the screen (404 ER-01, 401 ER-05 on reload, 5xx / 403 ER-02) or stay silent (429 toast) */
  const left = (res: Response) => {
    if (res.status === 404) setGone(true);
    else if (res.status === 401) router.refresh();
    else if (res.status >= 500 || res.status === 403) fatal();
    else return res.status === 429;
    return true;
  };

  function open(id: string | null, values: Values, rows: CardRow[]) {
    fe.setErrors({});
    setV({ ...values, ...Object.fromEntries(rows.map((c) => [cardKey(c.clinicId), c.cardNo])) });
    setCards(rows);
    setForm({ id }); // Q7 A: an open form is replaced silently
  }

  // ── event 2 ──
  function add() {
    setBanner(null);
    if (data.members.length >= data.max) {
      setForm(null);
      return setBanner("PE046");
    }
    open(null, { ...data.prefill }, data.clinics.map((c) => ({ clinicId: c.clinicId, cardNo: "", confirmed: false })));
  }

  // ── event 3 ──
  async function edit(m: Member) {
    setBanner(null);
    const res = await apiFetch(`/api/mypage/family/member?id=${encodeURIComponent(m.id)}`);
    if (!res || left(res)) return;
    if (!res.ok) return fatal();
    const { member } = (await res.json()) as { member: { id: string; relation: string; values: Values; cards: CardRow[] } };
    open(member.id, { ...member.values, relation: member.relation }, member.cards);
  }

  // ── event 6 ──
  async function save() {
    setBanner(null);
    if (!fe.all()) return;
    setBusy(true);
    try {
      const res = await apiFetch(...postJson("/api/mypage/family/save", body()));
      if (!res) return;
      const out = await res.json().catch(() => ({}));
      if (res.ok) {
        toast("PI042");
        setForm(null);
        router.refresh();
      } else if (res.status === 409) setBanner("PE046"); // 6-5: the form keeps its input (Q12)
      else if (res.status === 400 && out.errors) fe.fromServer(out.errors);
      else if (!left(res)) fatal();
    } finally {
      setBusy(false);
    }
  }

  // ── events 7 / 9 ──
  async function remove(m: Member, confirm: boolean) {
    setBanner(null);
    const res = await apiFetch(...postJson("/api/mypage/family/delete", { patientId: m.id, confirm }));
    if (!res) return;
    if (res.status === 409) {
      setDel(null);
      return setBanner("PE043");
    }
    if (left(res)) return;
    if (!res.ok) return fatal();
    if (!confirm) return setDel(m); // event 8
    setDel(null);
    if (form?.id === m.id) setForm(null);
    toast("PI047");
    router.refresh();
  }

  function close() {
    setBanner(null);
    setForm(null); // event 11: discarded without a question
  }

  const empty = data.members.length === 0;
  const ready = REQUIRED.every((k) => filled(v[k]));
  const addButton = (cls: string) => (
    <Button variant={empty ? "primary" : "secondary"} className={cls} onClick={add}><Icon name="plus" />{label("addMember", lang)}</Button>
  );

  return (
    <div className="col g16" data-testid="p07">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="col g4">
          <h1 className="m0" style={{ fontSize: 22 }}>{label("familyTitle", lang)}</h1>
          <p className="m0 sm mut">{label("familyLead", lang, { n: data.max })}</p>
        </div>
        {!empty && addButton("fam-d")}
      </div>
      {banner && (
        <p className="err m0 row" role="alert" data-testid="p07-banner"><Icon name="alert" />{t(banner, lang, { n: data.max })}</p>
      )}
      <div className="fam">
        <div className="col g12">
          {empty ? (
            <div className="box col g12" style={{ alignItems: "center", textAlign: "center" }} data-testid="p07-empty">
              <span className="avatar" aria-hidden="true"><Icon name="user" /></span>
              <p className="m0">{t("PI046", lang)}</p>
              {addButton("")}
            </div>
          ) : (
            <>
              <h2 className="m0" style={{ fontSize: 15 }}>{label("familyListHeading", lang, { n: data.members.length })}</h2>
              <ul className="cards m0" style={{ listStyle: "none", padding: 0 }}>
                {data.members.map((m) => {
                  const name = memberName(m, lang);
                  const cur = form?.id === m.id;
                  return (
                    <li key={m.id} className={`card ${cur ? "cur" : ""}`} data-testid="p07-member">
                      <div className="row">
                        <span className="avatar" aria-hidden="true">{[...m.givenName][0]?.toUpperCase()}</span>
                        <div className="col g4" style={{ flex: 1 }}>
                          <span className="row" style={{ flexWrap: "wrap" }}>
                            <b>{name}</b><span className="badge">{label(`rel${m.relation}` as LabelKey, lang)}</span>
                            {cur && <span className="badge badge-pri">{label("editing", lang)}</span>}
                          </span>
                          <span className="xs mut">{born(m.birthDate, lang)}</span>
                        </div>
                      </div>
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        <Link className="btn bp" href={`/booking/new?patient=${m.id}`}>{label("bookForMember", lang)}</Link>
                        <Button variant="secondary" onClick={() => edit(m)}>{label("edit", lang)}</Button>
                        <Button variant="danger" onClick={() => remove(m, false)}>{label("delete", lang)}</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {addButton("fam-m bw")}
            </>
          )}
          {!form && <p className="m0 xs mut fam-m">{label("familyLeadShort", lang, { n: data.max })}</p>}
        </div>

        {form && (
          <section className="sheet" aria-labelledby={id("heading")} data-testid="p07-form">
            <div className="row" style={{ justifyContent: "space-between" }}>
              {/* Q8: one heading for add and edit (item 7: 「家族の情報を編集」 above the form) */}
              <h2 id={id("heading")} className="m0" style={{ fontSize: 17 }}>{label("editHeading", lang)}</h2>
              <button type="button" className="ib fam-m" aria-label={label("close", lang)} onClick={close}><Icon name="close" /></button>
            </div>
            <ErrorSummary errors={fe.summary} lang={lang} />
            <form className="col g16" noValidate onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
              <Field id={id("relation")} name={label("relation", lang)} lang={lang} required error={err("relation")}>
                <select
                  id={id("relation")} className="inp w-pref" value={v.relation ?? ""} onChange={(e) => set({ relation: e.target.value })}
                  onBlur={() => fe.blur("relation")} {...invalid(id("relation"), err("relation"))}
                >
                  <option value="">{label("choose", lang)}</option>
                  {RELATIONS.map((r) => <option key={r} value={r}>{label(`rel${r}`, lang)}</option>)}
                </select>
              </Field>
              <NameFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />
              <BirthSexFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} />
              <div className="col g4">
                <h3 className="m0 sm fam-m">{label("addressContact", lang)}</h3>
                {!form.id && <p className="m0 xs mut fam-m">{label("addPrefillHelp", lang)}</p>}
                <span className="lbl fam-d">{label("addressGroup", lang)}</span>
              </div>
              <AddressFields form={FORM} lang={lang} values={v} set={set} blur={fe.blur} err={err} phoneRequired={false} />
              <div className="fld">
                <span className="lbl">{label("cardNo", lang)}<span className="opt">{label("optional", lang)}</span></span>
                <div className="col g8">
                  {cards.map((c) => {
                    const k = cardKey(c.clinicId);
                    const name = clinicName(c.clinicId);
                    return (
                      <div key={c.clinicId} className="col g4">
                        <label className="sm" htmlFor={id(k)}>
                          {name} {c.cardNo && !c.confirmed && <span className="badge badge-warn">{label("unconfirmed", lang)}</span>}
                        </label>
                        <input
                          id={id(k)} className="inp" value={v[k] ?? ""} maxLength={20} readOnly={c.confirmed} placeholder={label("unregistered", lang)}
                          onChange={(e) => set({ [k]: e.target.value })} onBlur={() => fe.blur(k)} {...invalid(id(k), err(k))}
                        />
                        {err(k) && <p className="fe m0" id={`${id(k)}-err`}><Icon name="alert" size={16} />{err(k)}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Button type="submit" disabled={!ready} busy={busy}>{label("saveBtn", lang)}</Button>
                <Button variant="secondary" onClick={close}>{label("close", lang)}</Button>
              </div>
            </form>
          </section>
        )}
      </div>
      <ConfirmDialog
        open={!!del} destructive messageId="PW004"
        title={del ? label("deleteTitle", lang, { name: memberName(del, lang) }) : ""}
        params={del ? { 氏名: memberName(del, lang), name: memberName(del, lang) } : {}}
        onConfirm={() => (del ? remove(del, true) : undefined)} onCancel={() => setDel(null)}
      />
    </div>
  );
}
