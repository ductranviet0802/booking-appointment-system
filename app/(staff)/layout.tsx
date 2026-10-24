// Staff frame: CF-03 above the screen. Every staff screen S01-S03 and A01-A06 lives in this route group (Japanese only).
import { StaffFrameHeader } from "@/components/frame/Frames";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <StaffFrameHeader />
      <main className="main main-staff">{children}</main>
    </div>
  );
}
