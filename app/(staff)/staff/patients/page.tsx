// spec-screen: S03
// 検索 view. The conditions live in the query string (Q16 A): a search is a navigation, the server re-runs 4.2 No. 1–6 and 抽出1,
// and 検索結果へ戻る returns here with the same query (the results are searched again).
import { forbidden, redirect } from "next/navigation";
import { guardScreen } from "@/lib/auth/context";
import { searchPatients } from "@/lib/staff/patients";
import { checkSearch, EMPTY_SEARCH, SEARCH_KEYS, type SearchInput } from "@/lib/staff/patients-rules";
import { SearchClient } from "./SearchClient";

export default async function PatientSearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await guardScreen("S03");
  if (!session?.clinicId) forbidden();
  const q = await searchParams;
  // T076 from S01 (S01 11-1 names `?patientId=`, S03 §2.1 `/staff/patients/{id}`): both land on the detail
  if (typeof q.patientId === "string" && /^[0-9a-f-]{36}$/i.test(q.patientId)) redirect(`/staff/patients/${q.patientId}`);
  const input: SearchInput = { ...EMPTY_SEARCH };
  for (const k of SEARCH_KEYS) if (typeof q[k] === "string") input[k] = (q[k] as string).slice(0, 200);
  const asked = SEARCH_KEYS.some((k) => q[k] !== undefined);
  const clinic = session.clinics.find((c) => c.id === session.clinicId)!;
  if (!asked) return <SearchClient input={input} clinicName={clinic.nameJa} result={null} errors={[]} />;
  const { errors, conditions } = checkSearch(input);
  const result = errors.length ? null : await searchPatients(session.clinicId, conditions);
  return <SearchClient input={input} clinicName={clinic.nameJa} result={result} errors={errors} />;
}
