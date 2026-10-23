// Logo-only CF-01 (no menu, no footer): CF-04 re-consent, and later the staff 初回変更 mode of P05.
import { PatientFrameHeader } from "@/components/frame/Frames";

export default function LogoOnlyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <PatientFrameHeader logoOnly />
      <main className="main">{children}</main>
    </div>
  );
}
