// spec-screen: P12 — the 2026.1 question set (10 §3 order, department blocks, sex / age conditions, follow-ups), the
// checks (required, lengths, ranges, Q6 number forms, Q11 tampered codes / NONE with another code, hidden answers
// dropped), 回答状況 / 次へ, the route (draft expiry → PE036, 戻る keeps answers, the language of 次へ), the page loader.
jest.mock("next/headers", () => ({
  cookies: async () => {
    const w = globalThis as unknown as { w1jar?: { sid?: string }; w1als?: { getStore(): string | undefined } };
    const sid = w.w1als?.getStore() ?? w.w1jar?.sid;
    return { get: (n: string) => (n === "sid" && sid ? { value: sid } : undefined) };
  },
  headers: async () => ({ get: () => null }),
}));
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";

import { POST as save } from "@/app/api/booking/questionnaire/route";
import { DRAFT_TTL_MS, EMPTY_SELECTIONS, getDraft, putDraft } from "@/lib/booking/draft";
import { loadQuestionnaire } from "@/lib/entry/pages";
import { ageOn, checkAnswers, keepAnswers, progressOf, requiredSet, shownQuestions, type Person } from "@/lib/entry/questionnaire";
import { pool, prisma } from "@/lib/prisma";
import { cleanup, DAY, holder, member, req, setup, type Holder, type Setup } from "./w1-helpers";

jest.setTimeout(90_000);
let S: Setup;
beforeAll(async () => { S = await setup(); });
afterAll(async () => {
  await cleanup(S.f).catch(() => undefined);
  await prisma.$disconnect();
  await pool.end();
});

const naikaWoman: Person = { dept: "naika", sex: "FEMALE", age: 34 };
const ids = (p: Person, a = {}) => shownQuestions(p, a).map((q) => q.id);
const fullNaika = { C01: "頭痛", C02: "TODAY", IM03: "NO", C03: "NONE", C04: "NONE", C05: ["NONE"], C06: "NO", C07: "NO", C08: "NEVER", C09: "NONE", C10: "NO" };

describe("P12 question set and conditions (10 §1.3, §3)", () => {
  it("order C01, C02 → department block → C03 … C11; 14 top-level for 内科 / woman 34 (the drawn case)", () => {
    expect(ids(naikaWoman)).toEqual(["C01", "C02", "IM01", "IM02", "IM03", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C11"]);
    expect(progressOf(naikaWoman, {})).toEqual({ done: 0, total: 14 });
  });

  it("小児科: PED03 only up to age 5, C06–C09 hidden for a child; 皮膚科 block; a man has no C06 / C07", () => {
    expect(ids({ dept: "shonika", sex: "FEMALE", age: 5 })).toEqual(["C01", "C02", "PED01", "PED02", "PED03", "PED04", "PED05", "C03", "C04", "C05", "C10", "C11"]);
    expect(ids({ dept: "shonika", sex: "FEMALE", age: 6 })).not.toContain("PED03");
    expect(ids({ dept: "hifuka", sex: "MALE", age: 40 })).toEqual(["C01", "C02", "DER01", "DER02", "DER03", "C03", "C04", "C05", "C08", "C09", "C10", "C11"]);
    expect(ids({ dept: "naika", sex: "FEMALE", age: 56 })).not.toContain("C06");
    expect(ids({ dept: "naika", sex: "FEMALE", age: 12 })).toContain("C07");
  });

  it("age = 満年齢 on the visit date, up on the birthday", () => {
    expect(ageOn("2021-10-29", "2026-10-28")).toBe(4);
    expect(ageOn("2021-10-29", "2026-10-29")).toBe(5);
  });

  it("follow-ups open under their parent; C05a only for a code other than NONE and required only for SURGERY / OTHER", () => {
    expect(ids(naikaWoman, { C03: "YES", C04: "YES", C06: "PREGNANT", C08: "CURRENT" })).toEqual(expect.arrayContaining(["C03a", "C03b", "C04a", "C04b", "C06a", "C08a"]));
    expect(ids(naikaWoman, { C05: ["NONE"] })).not.toContain("C05a");
    const hyper = { ...fullNaika, C05: ["HYPERTENSION"] };
    expect(requiredSet(naikaWoman, hyper)).toBe(true); // C05a shown, optional
    expect(requiredSet(naikaWoman, { ...hyper, C05: ["SURGERY"] })).toBe(false);
    expect(requiredSet(naikaWoman, fullNaika)).toBe(true);
    expect(requiredSet(naikaWoman, { ...fullNaika, C01: "　 " })).toBe(false); // spaces only = empty (Q9 b A)
  });
});

describe("P12 checks (§4.2, server re-check 11-3)", () => {
  it("required → PE001; length → PE003 {n}; a well-formed number out of range → PE038 {最小}{最大}; other forms → PE002 (Q6 A)", () => {
    const r = checkAnswers(naikaWoman, { ...fullNaika, C01: "", C11: "あ".repeat(401), IM01: "45.0" });
    expect(r.errors).toEqual([
      { field: "C01", code: "PE001" },
      { field: "IM01", code: "PE038", params: { 最小: "34.0", 最大: "42.0", min: "34.0", max: "42.0" } },
      { field: "C11", code: "PE003", params: { n: 400 } },
    ]);
    for (const bad of ["37.45", "３７.５", "-37", "37,5", "abc"]) expect(checkAnswers(naikaWoman, { ...fullNaika, IM01: bad }).errors).toEqual([{ field: "IM01", code: "PE002" }]);
    const kid: Person = { dept: "shonika", sex: "MALE", age: 2 };
    const kidBase = { C01: "熱", C02: "TODAY", PED02: "12.5", PED04: "ALL", C03: "NONE", C04: "NONE", C05: ["NONE"], C10: "NO" };
    expect(checkAnswers(kid, { ...kidBase, PED03: "3000.5" }).errors).toEqual([{ field: "PED03", code: "PE002" }]); // integer field
    expect(checkAnswers(kid, { ...kidBase, PED03: "299" }).errors[0]).toMatchObject({ code: "PE038", params: { 最小: "300", 最大: "6000" } });
    expect(checkAnswers(kid, { ...kidBase, PED03: "300" }).answers.PED03).toBe(300);
  });

  it("tampered: a code not in 10 or NONE with another code → PE002 (Q11 A); hidden questions are dropped; JSON per 10 §6", () => {
    expect(checkAnswers(naikaWoman, { ...fullNaika, C02: "YESTERDAY" }).errors).toEqual([{ field: "C02", code: "PE002" }]);
    expect(checkAnswers(naikaWoman, { ...fullNaika, C05: ["NONE", "ASTHMA"] }).errors).toEqual([{ field: "C05", code: "PE002" }]);
    const r = checkAnswers({ dept: "naika", sex: "MALE", age: 34 }, { ...fullNaika, PED02: "10", C03a: "x", IM01: "36.5", IM02: [] });
    expect(r.errors).toEqual([]);
    expect(r.answers).toEqual({ C01: "頭痛", C02: "TODAY", IM01: 36.5, IM03: "NO", C03: "NONE", C04: "NONE", C05: ["NONE"], C08: "NEVER", C09: "NONE", C10: "NO" });
    expect(keepAnswers(naikaWoman, { C01: "途中", C02: "BAD", C03: "YES" })).toEqual({ C01: "途中", C03: "YES" }); // 戻る keeps valid answers only
  });
});

describe("P12 route and page", () => {
  const draft = (h: Holder, o: { patientId?: string; visitTypeId?: string; change?: { bookingId: string; version: number } } = {}, at = Date.now()) => putDraft({
    kind: "DRAFT", accountId: h.acc.id, sessionId: h.ctx.sessionId, origin: "/", change: o.change ?? null, questionnaire: null, bookingId: null,
    sel: { ...EMPTY_SELECTIONS, patientId: o.patientId ?? h.self.id, clinicId: S.f.clinic.id, departmentId: S.f.dept.id, visitTypeId: o.visitTypeId ?? S.first.id, date: DAY, start: "09:00" },
  }, at);
  const owner = (h: Holder) => ({ accountId: h.acc.id, sessionId: h.ctx.sessionId });
  const answers = { C01: "頭痛", C02: "TODAY", C03: "NONE", C04: "NONE", C05: ["NONE"], C08: "NEVER", C09: "NONE", C10: "NO" }; // the fixture dept code is not naika

  it("次へ: errors stay (400, nothing kept); valid answers kept with the draft, language of the session (Q10 A) → P13", async () => {
    const h = await holder();
    const d = draft(h);
    const bad = await save(req("/api/booking/questionnaire", { body: { action: "next", answers: { C01: "" } }, draft: d.id, as: h }));
    expect(bad.status).toBe(400);
    expect(getDraft(d.id, owner(h))!.questionnaire).toBeNull();
    const ok = await save(req("/api/booking/questionnaire", { body: { action: "next", answers }, draft: d.id, as: h }));
    expect((await ok.json()).to).toBe("/booking/confirm");
    expect(getDraft(d.id, owner(h))!.questionnaire).toEqual({ answers, language: "JA", complete: true });
    expect(await prisma.questionnaire.count({ where: { booking: { patientId: h.self.id } } })).toBe(0); // P12 writes nothing (§8)
  });

  it("戻る keeps the answers so far (complete: false) → P11; an expired / foreign draft → P11 PE036", async () => {
    const h = await holder();
    const d = draft(h);
    const back = await save(req("/api/booking/questionnaire", { body: { action: "back", answers: { C01: "途中" } }, draft: d.id, as: h }));
    expect((await back.json()).to).toBe("/booking/new?resume=1");
    expect(getDraft(d.id, owner(h))!.questionnaire).toMatchObject({ answers: { C01: "途中" }, complete: false });
    const old = draft(h, {}, Date.now() - DRAFT_TTL_MS - 1);
    const expired = await save(req("/api/booking/questionnaire", { body: { action: "next", answers }, draft: old.id, as: h }));
    expect([expired.status, (await expired.json()).to]).toEqual([410, "/booking/new?e=PE036"]);
    const other = await holder();
    const foreign = await save(req("/api/booking/questionnaire", { body: { action: "next", answers }, draft: d.id, as: other }));
    expect((await foreign.json()).to).toBe("/booking/new?e=PE036");
    expect((await save(req("/api/booking/questionnaire", { body: { action: "next", answers }, draft: d.id }))).status).toBe(401);
  });

  it("page: the 問診 of the draft's person (a family member: their sex / age); 再診 or change mode → PE036; restored answers", async () => {
    const h = await holder();
    const kid = await member(h, "花子", "2023-01-01");
    const d = draft(h, { patientId: kid.id });
    const r = await loadQuestionnaire({ session: h.ctx, draftId: d.id, lang: "ja" });
    expect(r.kind === "ok" && r.props.person).toEqual({ dept: S.f.dept.code, sex: "FEMALE", age: ageOn("2023-01-01", DAY) });
    expect(r.kind === "ok" && r.props.summary).toMatchObject({ name: "予約 花子", type: "初診", date: DAY, start: "09:00" });
    const repeat = draft(h, { visitTypeId: S.f.visitType.id });
    expect(await loadQuestionnaire({ session: h.ctx, draftId: repeat.id, lang: "ja" })).toEqual({ kind: "redirect", to: "/booking/new?e=PE036" });
    expect(await loadQuestionnaire({ session: h.ctx, draftId: undefined, lang: "ja" })).toEqual({ kind: "redirect", to: "/booking/new?e=PE036" });
  });
});
