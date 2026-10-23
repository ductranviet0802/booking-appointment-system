// spec-screen: P08
// Pure parts of the P08 query string, importable by client components (doctors.ts reads the database and must stay on the server).
import type { Options } from "./doctors";

export type DoctorQuery = { keyword: string; clinic: string; department: string; language: string; page: number };
export const EMPTY_QUERY: DoctorQuery = { keyword: "", clinic: "", department: "", language: "", page: 1 };

/** query string of a state: parameters left out when empty / すべて / page 1 (event 2 table) */
export function doctorQueryString(q: Partial<DoctorQuery>) {
  const sp = new URLSearchParams();
  if (q.keyword) sp.set("keyword", q.keyword);
  if (q.clinic) sp.set("clinic", q.clinic);
  if (q.department) sp.set("department", q.department);
  if (q.language) sp.set("language", q.language);
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  return sp.toString();
}

/** The departments the select offers for a clinic (all when none; event 3, Q13 order) */
export function departmentsFor(options: Options, clinic: string) {
  if (!clinic) return options.departments;
  return options.departments
    .filter((d) => clinic in d.clinicOrder)
    .sort((a, b) => a.clinicOrder[clinic] - b.clinicOrder[clinic]);
}
