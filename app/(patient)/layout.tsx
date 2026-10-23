// Patient frame: CF-01 header above, CF-02 footer below. Every patient screen P01-P16 lives in this route group.
import { PatientFrameHeader } from "@/components/frame/Frames";
import { PatientFooter } from "@/components/frame/PatientFooter";
import { getLanguage } from "@/lib/i18n/server";

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLanguage();
  return (
    <div className="page">
      <PatientFrameHeader />
      <main className="main">{children}</main>
      <PatientFooter lang={lang} />
    </div>
  );
}
