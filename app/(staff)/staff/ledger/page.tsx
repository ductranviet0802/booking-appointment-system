import { guardScreen } from "@/lib/auth/context";

// Placeholder until S01 予約台帳: the target of 「予約台帳へ」 (ER-02, ER-03) and of the first menu entry.
export default async function Ledger() {
  await guardScreen("S01");
  return <p>S01 予約台帳（placeholder until S01）</p>;
}
