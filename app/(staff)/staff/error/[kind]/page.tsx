// The staff error screens a client action leads to when its API call is refused (02 §4 T096 / T068 / T097):
// forbidden → ER-03 (SE091), expired → ER-05, anything else → ER-02 (SE090). Not a screen of its own.
import { forbidden, unauthorized } from "next/navigation";

export default async function StaffErrorScreen({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind === "forbidden") forbidden();
  if (kind === "expired") unauthorized();
  throw new Error("ER-02 after a refused staff request");
}
