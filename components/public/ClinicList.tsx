// spec-screen: P10
// Clinic-list state ①: one card per active clinic; the whole card is the link (item 3-1).
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";
import { formatPhone } from "@/lib/public/phone";
import type { loadClinicIndex } from "@/lib/public/p10";

type Cards = Extract<Awaited<ReturnType<typeof loadClinicIndex>>, { kind: "list" }>["cards"];

export function ClinicList({ cards, lang }: { cards: Cards; lang: Lang }) {
  return (
    <div className="flex flex-col gap-4" data-testid="p10-list">
      <h1 className="m-0 text-xl font-bold">{label("clinicInfoHeading", lang)}</h1>
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        {cards.map((c) => (
          <li key={c.code}>
            <Link href={`/clinics/${c.code}`} className="box h-full no-underline">
              <b className="text-lg">{c.name}</b>
              <span className="flex gap-2"><Icon name="pin" /><span>{c.address}</span></span>
              <span>{formatPhone(c.phone)}</span>
              {c.todayText ? (
                <span className="flex gap-2"><Icon name="clock" /><span>{label("todayPrefix", lang)} {c.todayText}</span></span>
              ) : (
                <span className="flex gap-2 font-bold text-[color:var(--dan)]"><Icon name="clock" /><span>{label("todayClosed", lang)}</span></span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
