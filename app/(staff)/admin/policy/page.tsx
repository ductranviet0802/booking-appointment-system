// spec-screen: A04
import { forbidden } from "next/navigation";
import { loadState } from "@/lib/admin/policy";
import { guardScreen } from "@/lib/auth/context";
import { PolicyClient } from "./PolicyClient";

export default async function PolicyPage() {
  const session = await guardScreen("A04");
  if (!session?.clinicId) forbidden();
  return <PolicyClient initial={await loadState(session.clinicId)} />;
}
