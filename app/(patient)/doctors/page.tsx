// spec-screen: P08
// 医師検索 `/doctors`: conditions come from the query string; a value the UI cannot produce → ER-02 (PE090).
import { DoctorResults } from "@/components/public/DoctorResults";
import { FinderShell } from "@/components/public/DoctorFinder";
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { loadOptions, parseDoctorQuery, searchDoctors } from "@/lib/public/doctors";

export default async function DoctorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await guardScreen("P08");
  const lang = await getLanguage();
  const options = await loadOptions(lang);
  const query = parseDoctorQuery(await searchParams, options);
  if (!query) throw new Error("PE090: P08 query string the UI cannot produce");
  const result = await searchDoctors(query, lang);
  return (
    <FinderShell lang={lang} options={options} query={query}>
      <DoctorResults query={query} result={result} lang={lang} />
    </FinderShell>
  );
}
