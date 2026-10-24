// spec-screen: S03
// 検索 view. The conditions live in the query string (Q16 A): a search is a navigation, the server re-runs 4.2 No. 1–6 and 抽出1,
// and 検索結果へ戻る returns here with the same query (the results are searched again).
import { forbidden } from "next/navigation";
import { guardScreen } from "@/lib/auth/context";
import { searchPatients } from "@/lib/staff/patients";
import { checkSearch, EMPTY_SEARCH, SEARCH_KEYS, type SearchInput } from "@/lib/staff/patients-rules";
import { SearchClient } from "./SearchClient";

export default async function PatientSearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await guardScreen("S03");
  if (!session?.clinicId) forbidden();
  const q = await searchParams;
  const input: SearchInput = { ...EMPTY_SEARCH };
  for (const k of SEARCH_KEYS) if (typeof q[k] === "string") input[k] = (q[k] as string).slice(0, 200);
  const asked = SEARCH_KEYS.some((k) => q[k] !== undefined);
  const clinic = session.clinics.find((c) => c.id === session.clinicId)!;
  if (!asked) return <SearchClient input={input} clinicName={clinic.nameJa} result={null} errors={[]} />;
  const { errors, conditions } = checkSearch(input);
  const result = errors.length ? null : await searchPatients(session.clinicId, conditions);
  return <SearchClient input={input} clinicName={clinic.nameJa} result={result} errors={errors} />;
}
