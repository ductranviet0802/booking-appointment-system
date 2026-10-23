import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

jest.mock("@/lib/auth/context", () => ({ getSession: jest.fn(), guardScreen: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { update: jest.fn() },
    consent: { createMany: jest.fn() },
    consentDocument: { findMany: jest.fn() },
  },
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));
jest.mock("next/link", () => ({ __esModule: true, default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a> }));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn() }));

import { getSession } from "@/lib/auth/context";
import { prisma } from "@/lib/prisma";
import { POST as postConsents } from "@/app/api/consents/route";
import { POST as postLocale } from "@/app/api/locale/route";
import { PatientHeader } from "@/components/frame/PatientHeader";
import { StaffHeader } from "@/components/frame/StaffHeader";
import { staffMenu } from "@/lib/frame/menu";

const session = getSession as jest.Mock;
const db = prisma as unknown as {
  account: { update: jest.Mock };
  consent: { createMany: jest.Mock };
  consentDocument: { findMany: jest.Mock };
};

const req = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
const patient = (reconsent: string[]) => ({ account: { id: "a1", role: "PATIENT", language: "JA" }, reconsent, clinics: [] });

describe("POST /api/locale", () => {
  it("refuses another value and writes nothing", async () => {
    session.mockResolvedValue(patient([]));
    const res = await postLocale(req("/api/locale", { language: "fr" }));
    expect(res.status).toBe(400);
    expect(db.account.update).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("sets the cookie and the patient's language", async () => {
    session.mockResolvedValue(patient([]));
    const res = await postLocale(req("/api/locale", { language: "vi" }));
    expect(res.status).toBe(200);
    expect(db.account.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { language: "VI" } });
    expect(res.headers.get("set-cookie")).toContain("lang=vi");
  });
  it("anonymous: cookie only", async () => {
    session.mockResolvedValue(null);
    const res = await postLocale(req("/api/locale", { language: "en" }));
    expect(res.status).toBe(200);
    expect(db.account.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/consents", () => {
  it("PE008 and nothing written when a shown kind is not agreed", async () => {
    session.mockResolvedValue(patient(["TERMS", "PRIVACY"]));
    const res = await postConsents(req("/api/consents", { consents: { TERMS: { version: "1.0", agreed: true } } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "PE008", params: { kinds: ["PRIVACY"] } });
    expect(db.consent.createMany).not.toHaveBeenCalled();
  });
  it("writes one row per kind on success", async () => {
    session.mockResolvedValue(patient(["TERMS"]));
    db.consentDocument.findMany.mockResolvedValue([{ kind: "TERMS", version: "1.0" }]);
    const res = await postConsents(req("/api/consents", { consents: { TERMS: { version: "1.0", agreed: true } } }));
    expect(res.status).toBe(200);
    expect(db.consent.createMany.mock.calls[0][0].data).toHaveLength(1);
  });
  it("rejects a version the server does not know", async () => {
    session.mockResolvedValue(patient(["TERMS"]));
    db.consentDocument.findMany.mockResolvedValue([{ kind: "TERMS", version: "1.0" }]);
    const res = await postConsents(req("/api/consents", { consents: { TERMS: { version: "9.9", agreed: true } } }));
    expect(res.status).toBe(400);
    expect(db.consent.createMany).not.toHaveBeenCalled();
  });
});

describe("frames", () => {
  const props = { lang: "ja" as const, groupName: "G", clinicsHref: "/clinics" };
  it("CF-01 anonymous: lock icons on 予約一覧 / マイページ and ログイン / 会員登録", () => {
    const html = renderToStaticMarkup(<PatientHeader {...props} userName={null} />);
    expect(html).toContain("ログイン");
    expect(html).toContain("会員登録");
    expect(html.match(/class="[^"]*lock[^"]*"/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("CF-01 logged in: name 様 and ログアウト, no lock", () => {
    const html = renderToStaticMarkup(<PatientHeader {...props} userName="山田 太郎" />);
    expect(html).toContain("山田 太郎様");
    expect(html).toContain("ログアウト");
    expect(html).not.toContain("ログイン");
  });
  it("CF-03 menu per role", () => {
    expect(staffMenu("ADMIN").map((e) => e.screen)).toEqual(["S01", "S02", "S03", "A01", "A02", "A03", "A04", "A05", "A06"]);
    const rec = staffMenu("RECEPTION");
    expect(rec.map((e) => e.screen)).toEqual(["S01", "S02", "S03", "A01", "A02", "A03", "A06"]);
    expect(rec.filter((e) => e.readOnly).map((e) => e.screen)).toEqual(["A01", "A02", "A03"]);
    expect(staffMenu("DOCTOR").map((e) => e.label)).toEqual(["予約台帳（自分）", "医師シフト（自分）"]);
  });
  it("CF-03 single clinic is a label, several a select", () => {
    const base = { groupName: "G", role: "ADMIN" as const, displayName: "管理者", clinicId: "c1" };
    const one = renderToStaticMarkup(<StaffHeader {...base} clinics={[{ id: "c1", nameJa: "本院" }]} />);
    expect(one).not.toContain("<select");
    expect(one).toContain("本院");
    const two = renderToStaticMarkup(<StaffHeader {...base} clinics={[{ id: "c1", nameJa: "本院" }, { id: "c2", nameJa: "分院" }]} />);
    expect(two).toContain("<select");
  });
});
