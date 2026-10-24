// Patient frame: CF-01 header above, CF-02 footer below. Every patient screen P01-P16 lives in this route group.
// The error frames of the group (error.tsx, not-found.tsx, unauthorized.tsx) draw an .eb block; globals.css hides CF-02
// for them (.page:has(.eb) .ft, F-04 / _common §3).
import { PatientFrameHeader } from "@/components/frame/Frames";
import { PatientFooter } from "@/components/frame/PatientFooter";
import { FlashToast } from "@/components/patient/FlashToast";
import { getLanguage } from "@/lib/i18n/server";

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLanguage();
  return (
    <div className="page">
      <PatientFrameHeader />
      <main className="main">{children}</main>
      <PatientFooter lang={lang} />
      <FlashToast />
    </div>
  );
}
