// Server-side reads of the common frames, cached per request.
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/context";
import type { SessionContext } from "@/lib/auth/context";
import { cookies } from "next/headers";
import { DEFAULT_LANG, LANG_COOKIE, parseLang } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { maintenanceEnd, pickCurrentDocument, pickGroupName } from "./settings";

/** F13-01: staff screens are always ja; a logged-in patient uses accounts.language; else the cookie, else ja */
export function resolveLanguage(session: SessionContext | null, cookieValue: string | undefined): Lang {
  if (session) return session.account.role === "PATIENT" ? (parseLang(session.account.language) ?? DEFAULT_LANG) : "ja";
  return parseLang(cookieValue) ?? DEFAULT_LANG;
}

/** The session and language of the current request */
export const getViewer = cache(async () => {
  const session = await getSession();
  const lang = resolveLanguage(session, (await cookies()).get(LANG_COOKIE)?.value);
  return { session, lang };
});

export async function getLanguage() {
  return (await getViewer()).lang;
}

export const getSettings = cache(async () => {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ["group_name_ja", "group_name_en", "group_name_vi", "maintenance_from", "maintenance_to"] } },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>;
});

export async function getGroupName(lang: Lang) {
  return pickGroupName(await getSettings(), lang);
}

/** ER-04: the end time while the service is under maintenance, else null */
export async function getMaintenanceEnd() {
  return maintenanceEnd(await getSettings());
}

/** 抽出6: items 4 and 16 → /clinics, or the clinic's own page when exactly one clinic is active */
export const getClinicsHref = cache(async () => {
  const active = await prisma.clinic.findMany({ where: { isActive: true }, select: { code: true }, take: 2 });
  return active.length === 1 ? `/clinics/${active[0].code}` : "/clinics";
});

/** 抽出5: current terms and privacy policy of a language */
export async function getConsentLinks(lang: Lang) {
  const docs = await prisma.consentDocument.findMany({ where: { effectiveFrom: { lte: new Date() } } });
  const docsOf = docs.map((d) => ({ ...d, language: d.language as string }));
  return {
    terms: pickCurrentDocument(docsOf, "TERMS", lang),
    privacy: pickCurrentDocument(docsOf, "PRIVACY", lang),
  };
}
