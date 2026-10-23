// spec-screen: P01
// トップ `/`. Staff are sent to S01 by the guard (T070); anonymous and patients see the same page.
import { Suspense } from "react";
import { Home, HomeSkeleton } from "@/components/public/Home";
import { guardScreen } from "@/lib/auth/context";
import { getLanguage } from "@/lib/frame/data";
import { loadHome } from "@/lib/public/home";

async function HomeBody() {
  const lang = await getLanguage();
  return <Home data={await loadHome(lang)} lang={lang} />;
}

export default async function HomePage() {
  await guardScreen("P01");
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeBody />
    </Suspense>
  );
}
