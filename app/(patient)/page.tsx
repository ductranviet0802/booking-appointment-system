import { guardScreen } from "@/lib/auth/context";

// Placeholder until P01 トップ (wave W1); the guard sends staff on to S01 once the auth module is merged.
export default async function Home() {
  await guardScreen("P01");
  return <p>Web予約</p>;
}
