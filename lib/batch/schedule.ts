// 06 §0 schedule, Asia/Tokyo: B4 00:30 · B2 01:00 · B5 01:30 · B3 1st of the month 01:45 · B6 05:30 (daily jobs,
// once per day); B1 per clinic when its reminder_time fell in the last 5 minutes and it has no SUCCESS run today.
// Nothing is started inside the maintenance window Tue 02:00–05:00 (N-OPS-02).
import type { JobCode } from "@/lib/batch/runner";

const DAILY: Array<{ code: Exclude<JobCode, "B1">; at: string; monthDay?: number }> = [
  { code: "B4", at: "00:30" },
  { code: "B2", at: "01:00" },
  { code: "B5", at: "01:30" },
  { code: "B3", at: "01:45", monthDay: 1 },
  { code: "B6", at: "05:30" },
];

export type ScheduleState = {
  /** jobs with a SCHEDULE run started today (JST) */
  ranToday: Set<string>;
  /** clinics with their reminder time "HH:MM" */
  reminders: Array<{ clinicId: string; at: string }>;
  /** clinics with a SUCCESS B1 run today */
  remindedToday: Set<string>;
};

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function jstParts(now: Date) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { date: jst.toISOString().slice(0, 10), minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes(), weekday: jst.getUTCDay(), monthDay: jst.getUTCDate() };
}

export function dueJobs(now: Date, s: ScheduleState): Array<{ code: JobCode; clinicId: string | null }> {
  const t = jstParts(now);
  if (t.weekday === 2 && t.minutes >= 120 && t.minutes < 300) return [];
  const due: Array<{ code: JobCode; clinicId: string | null }> = DAILY.filter(
    (j) => t.minutes >= minutesOf(j.at) && !s.ranToday.has(j.code) && (!j.monthDay || j.monthDay === t.monthDay),
  ).map((j) => ({ code: j.code, clinicId: null }));
  for (const r of s.reminders) {
    const m = minutesOf(r.at);
    if (m <= t.minutes && t.minutes < m + 5 && !s.remindedToday.has(r.clinicId)) due.push({ code: "B1", clinicId: r.clinicId });
  }
  return due;
}
