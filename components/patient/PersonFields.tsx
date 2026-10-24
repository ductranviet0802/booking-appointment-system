"use client";

// The person block shared by P03 (items 7–20), P06 (25, 5–15) and P07 (8–19): name type, names, reading, date of birth
// (three selects), sex, address with the X4 lookup (reading 4) and phone. Values are the body shape of checkPerson.
import { useRef, useState } from "react";
import { PREFECTURES, digitsOnly } from "@/lib/auth/validate";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { todayJst } from "@/lib/datetime";
import { Icon } from "@/components/ui/Icon";
import { Field, fieldId, invalid } from "./form";

export type Values = Record<string, string>;
type Props = {
  form: string; lang: Lang; values: Values; set: (patch: Values) => void; blur: (...fields: string[]) => void;
  err: (field: string) => string | null; phoneRequired?: boolean; disabled?: boolean;
};

export const PERSON_LABELS = {
  nameType: "nameType", familyName: "familyName", givenName: "givenName", familyNameKana: "familyNameKana",
  givenNameKana: "givenNameKana", birthDate: "birthDate", sex: "sex", postcode: "postcode", prefecture: "prefecture",
  city: "city", town: "town", addressLine: "addressLine", building: "building", phone: "phone",
} as const;

/** "YYYY-MM-DD" from the three selects; partly chosen → "" (PE001, P03 Q10) */
export function birthOf(v: Values) {
  return v.bY && v.bM && v.bD ? `${v.bY}-${v.bM.padStart(2, "0")}-${v.bD.padStart(2, "0")}` : "";
}
/** the request body of the person part */
export const personOf = (v: Values) => ({ ...v, birthDate: birthOf(v) });

const OTHER = "__other";

export function NameFields({ form, lang, values: v, set, blur, err, disabled }: Props) {
  const romaji = v.nameType === "ROMAJI";
  const id = (f: string) => fieldId(form, f);
  const text = (f: string, ime: boolean, extra: Record<string, unknown> = {}) => (
    <input
      id={id(f)} className="inp" value={v[f] ?? ""} maxLength={60} disabled={disabled}
      lang={ime ? undefined : "en"} autoCapitalize={ime ? undefined : "characters"}
      onChange={(e) => set({ [f]: e.target.value })} onBlur={() => blur(f)} {...invalid(id(f), err(f))} {...extra}
    />
  );
  return (
    <>
      <Field id={id("nameType")} name={label("nameType", lang)} lang={lang} required group error={err("nameType")}>
        <div className="seg" role="radiogroup" aria-labelledby={`${id("nameType")}-lbl`}>
          {(["JP", "ROMAJI"] as const).map((k, i) => (
            <label key={k} className={`lopt ${v.nameType === k ? "on" : ""}`}>
              <input
                id={i === 0 ? id("nameType") : undefined} type="radio" name={id("nameType")} value={k} checked={v.nameType === k} disabled={disabled}
                onChange={() => {
                  set({ nameType: k });
                  // event 2: the kept values are checked again under the new rule
                  setTimeout(() => blur("familyName", "givenName", "familyNameKana", "givenNameKana"), 0);
                }}
              />
              {label(k === "JP" ? "nameJp" : "nameRomaji", lang)}
            </label>
          ))}
        </div>
      </Field>
      <div className="pair">
        <Field id={id("familyName")} name={label("familyName", lang)} lang={lang} required error={err("familyName")}>{text("familyName", !romaji)}</Field>
        <Field id={id("givenName")} name={label("givenName", lang)} lang={lang} required error={err("givenName")}>{text("givenName", !romaji)}</Field>
      </div>
      <div className="pair">
        <Field id={id("familyNameKana")} name={label("kanaSei", lang)} lang={lang} required error={err("familyNameKana")}>{text("familyNameKana", true)}</Field>
        <Field id={id("givenNameKana")} name={label("kanaMei", lang)} lang={lang} required error={err("givenNameKana")}>{text("givenNameKana", true)}</Field>
      </div>
      {!romaji && <p className="xs mut m0">{label("kanaHint", lang)}</p>}
    </>
  );
}

export function BirthSexFields({ form, lang, values: v, set, blur, err, disabled }: Props) {
  const id = (f: string) => fieldId(form, f);
  const thisYear = Number(todayJst().slice(0, 4));
  const years = Array.from({ length: thisYear - 1899 }, (_, i) => String(thisYear - i));
  const sel = (key: "bY" | "bM" | "bD", opts: string[], fmt: "yearOpt" | "monthOpt" | "dayOpt", aria: "yearAria" | "monthAria" | "dayAria", first?: boolean) => (
    <select
      id={first ? id("birthDate") : `${id("birthDate")}-${key}`} className="inp" value={v[key] ?? ""} disabled={disabled}
      aria-label={`${label("birthDate", lang)} ${label(aria, lang)}`}
      onChange={(e) => set({ [key]: e.target.value })} {...invalid(id("birthDate"), err("birthDate"))}
    >
      <option value="">{label("choose", lang)}</option>
      {opts.map((o) => <option key={o} value={o}>{label(fmt, lang, { y: o, m: o, d: o })}</option>)}
    </select>
  );
  const range = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
  return (
    <>
      <Field id={id("birthDate")} name={label("birthDate", lang)} lang={lang} required group error={err("birthDate")}>
        {/* the group is checked when focus leaves the three selects (4.2 row 16) */}
        <div className="dob" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) blur("birthDate"); }}>
          {sel("bY", years, "yearOpt", "yearAria", true)}
          {sel("bM", range(12), "monthOpt", "monthAria")}
          {sel("bD", range(31), "dayOpt", "dayAria")}
        </div>
      </Field>
      <Field id={id("sex")} name={label("sex", lang)} lang={lang} required group error={err("sex")} help={label("sexNote", lang)}>
        <div className="seg" role="radiogroup" aria-labelledby={`${id("sex")}-lbl`} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) blur("sex"); }}>
          {(["1", "2"] as const).map((k, i) => (
            <label key={k} className={`lopt ${v.sex === k ? "on" : ""}`}>
              <input id={i === 0 ? id("sex") : undefined} type="radio" name={id("sex")} value={k} checked={v.sex === k} disabled={disabled} onChange={() => set({ sex: k })} />
              {label(k === "1" ? "male" : "female", lang)}
            </label>
          ))}
        </div>
      </Field>
    </>
  );
}

/** reading 4 / X4: lookup on leaving the postcode, 300 ms debounce, through /api/postcode only */
export function AddressFields({ form, lang, values: v, set, blur, err, phoneRequired = true, disabled }: Props) {
  const id = (f: string) => fieldId(form, f);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"PE012" | "PE013" | null>(null);
  const [towns, setTowns] = useState<string[] | null>(null);
  const last = useRef(digitsOnly(v.postcode ?? ""));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function lookup() {
    blur("postcode");
    const code = digitsOnly(v.postcode ?? "");
    if (!/^\d{7}$/.test(code) || code === last.current) return; // only a changed 7-digit value (P07 Q12)
    last.current = code;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch(`/api/postcode?code=${code}`);
        if (res.ok) {
          const { candidates } = (await res.json()) as { candidates: Array<{ prefecture: string; city: string; town: string }> };
          const first = candidates[0];
          const many = candidates.length > 1 ? [...new Set(candidates.map((c) => c.town).filter(Boolean))] : [];
          set({ prefecture: first.prefecture, city: first.city, town: candidates.length === 1 ? first.town : "" });
          setTowns(many.length > 1 ? many : null);
          if (many.length === 1) set({ prefecture: first.prefecture, city: first.city, town: many[0] });
        } else {
          setTowns(null);
          setNote(res.status === 404 ? "PE012" : "PE013");
        }
      } catch {
        setTowns(null);
        setNote("PE013");
      } finally {
        setBusy(false);
      }
    }, 300);
  }

  const text = (f: string, max: number, extra: Record<string, unknown> = {}) => (
    <input
      id={id(f)} className="inp" value={v[f] ?? ""} maxLength={max} disabled={disabled}
      onChange={(e) => set({ [f]: e.target.value })} onBlur={() => blur(f)} {...invalid(id(f), err(f))} {...extra}
    />
  );

  return (
    <>
      <Field
        id={id("postcode")} name={label("postcode", lang)} lang={lang} required error={err("postcode")}
        help={busy ? <span className="row" role="status"><Icon name="spin" className="spin" size={14} />{label("postcodeSearching", lang)}</span> : label("postcodeHelp", lang)}
      >
        <div className="row">
          <span aria-hidden="true">〒</span>
          {text("postcode", 8, { inputMode: "numeric", autoComplete: "postal-code", className: "inp w-pc", onBlur: lookup })}
        </div>
      </Field>
      <Field id={id("prefecture")} name={label("prefecture", lang)} lang={lang} required error={err("prefecture")}>
        <select
          id={id("prefecture")} className="inp w-pref" value={v.prefecture ?? ""} disabled={disabled}
          onChange={(e) => set({ prefecture: e.target.value })} onBlur={() => blur("prefecture")} {...invalid(id("prefecture"), err("prefecture"))}
        >
          <option value="">{label("choose", lang)}</option>
          {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field id={id("city")} name={label("city", lang)} lang={lang} required error={err("city")}>{text("city", 50)}</Field>
      <Field id={id("town")} name={label("town", lang)} lang={lang} optional error={err("town")}>
        {towns ? (
          <select
            id={id("town")} className="inp" value={v.town ?? ""} disabled={disabled}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setTowns(null); // event 13: the text field takes the same Tab stop
                set({ town: "" });
                setTimeout(() => document.getElementById(id("town"))?.focus(), 0);
              } else set({ town: e.target.value });
            }}
          >
            <option value="">{label("choose", lang)}</option>
            {towns.map((tw) => <option key={tw} value={tw}>{tw}</option>)}
            <option value={OTHER}>{label("townOther", lang)}</option>
          </select>
        ) : text("town", 100)}
      </Field>
      {note && <p className="fe" role="status"><Icon name="alert" size={16} />{t(note, lang)}</p>}
      <Field id={id("addressLine")} name={label("addressLine", lang)} lang={lang} required error={err("addressLine")}>{text("addressLine", 200)}</Field>
      <Field id={id("building")} name={label("building", lang)} lang={lang} optional error={err("building")}>
        {text("building", 100, { placeholder: label("buildingPh", lang) })}
      </Field>
      <Field
        id={id("phone")} name={label("phone", lang)} lang={lang} required={phoneRequired} optional={!phoneRequired} error={err("phone")}
        help={phoneRequired ? label("phoneHelp", lang) : undefined}
      >
        {text("phone", 13, { inputMode: "tel", autoComplete: "tel", className: "inp w-ph", placeholder: phoneRequired ? undefined : label("phonePh", lang) })}
      </Field>
    </>
  );
}
