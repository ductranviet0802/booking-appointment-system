// spec-screen: S01
import { forbidden } from "next/navigation";
import { type Actor } from "@/lib/admin/common";
import { guardScreen } from "@/lib/auth/context";
import { loadLedger, type LedgerView } from "@/lib/staff/ledger";
import { showNo } from "@/lib/staff/ledger-rules";
import { LedgerClient } from "./LedgerClient";

type Params = { date?: string; booking?: string; filter?: string; flash?: string };

export default async function Ledger({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await guardScreen("S01");
  if (!session?.clinicId) forbidden();
  const p = await searchParams;
  const actor: Actor = {
    accountId: session.account.id, role: session.account.role, clinicId: session.clinicId, allClinics: session.account.allClinics,
    sessionId: session.sessionId, ip: null, now: new Date(),
  };
  // T087 / T080 / T079: date, booking (予約番号, highlighted), filter=adjust; names Q18. A malformed value falls back to today.
  let r = await loadLedger(actor, { date: p.date, filter: p.filter, highlight: p.booking });
  if (!r.ok && r.status === 400) r = await loadLedger(actor, {});
  if (!r.ok) forbidden();
  const view = r.body.view as LedgerView;
  const flash = p.flash === "SI020" && p.booking ? { id: "SI020", params: { 予約番号: showNo(p.booking) } } : p.flash === "SI021" ? { id: "SI021" } : null;
  return <LedgerClient initial={view} flash={flash} />;
}
