// Pure rules behind the common frames: group name (抽出1), consent documents (抽出5), maintenance period (抽出7).
import type { Lang } from "@/lib/i18n";

/** 抽出1: group_name_<lang>; an empty en / vi value shows the ja name */
export function pickGroupName(settings: Record<string, string>, lang: Lang) {
  return settings[`group_name_${lang}`]?.trim() || settings.group_name_ja?.trim() || "";
}

export type ConsentDoc = { kind: string; version: string; language: string; url: string; effectiveFrom: Date };

/** 抽出5: the document of the kind and language with the latest effective_from ≤ now */
export function pickCurrentDocument(docs: ConsentDoc[], kind: "TERMS" | "PRIVACY", lang: Lang, now = new Date()) {
  return (
    docs
      .filter((d) => d.kind === kind && d.language.toLowerCase() === lang && d.effectiveFrom <= now)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}

/** maintenance_from / _to are JST wall-clock values ("2026-10-21 06:00" or "2026-10-21T06:00"); an explicit offset is honoured */
export function parseJstSetting(value: string | undefined): Date | null {
  const m = /^\s*(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?\s*$/.exec(value ?? "");
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3] ?? "00"}${m[4] ?? "+09:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 抽出7: ER-04 only while both values are set and now is inside [from, to) (_common Q10) */
export function maintenanceEnd(settings: Record<string, string>, now = new Date()): Date | null {
  const from = parseJstSetting(settings.maintenance_from);
  const to = parseJstSetting(settings.maintenance_to);
  return from && to && from <= now && now < to ? to : null;
}
