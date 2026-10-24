// spec-screen: A06
import { forbidden } from "next/navigation";
import { loadExportState } from "@/lib/admin/export";
import { guardScreen } from "@/lib/auth/context";
import { ExportClient } from "./ExportClient";

export default async function ExportPage() {
  const session = await guardScreen("A06");
  if (!session?.clinicId) forbidden();
  return <ExportClient initial={await loadExportState(session.clinicId, session.account.role)} />;
}
