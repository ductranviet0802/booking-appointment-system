// Server wrappers that read the viewer and feed the client headers (events 22, 12-15; _common §3.1 "header follows the viewer").
import { PatientHeader } from "./PatientHeader";
import { StaffHeader } from "./StaffHeader";
import { getClinicsHref, getGroupName, getViewer } from "@/lib/frame/data";

/** CF-01 for the viewer; `anonymous` forces the logged-out state (ER-05, Q6), `logoOnly` the logo-only variant */
export async function PatientFrameHeader({ anonymous = false, logoOnly = false }: { anonymous?: boolean; logoOnly?: boolean }) {
  const { session, lang } = await getViewer();
  const [groupName, clinicsHref] = await Promise.all([getGroupName(lang), getClinicsHref()]);
  const patient = !anonymous && session?.account.role === "PATIENT" ? session : null;
  return <PatientHeader lang={lang} groupName={groupName} userName={patient?.account.displayName ?? null} clinicsHref={clinicsHref} logoOnly={logoOnly} />;
}

/** CF-03 for the staff session; without one the logo-only header (the page's own guard answers the request) */
export async function StaffFrameHeader() {
  const { session, lang } = await getViewer();
  if (!session || session.account.role === "PATIENT") return <PatientFrameHeader logoOnly />;
  return (
    <StaffHeader
      groupName={await getGroupName(lang)}
      role={session.account.role}
      displayName={session.account.displayName}
      clinics={session.clinics}
      clinicId={session.clinicId}
    />
  );
}

/** ER-01 / ER-02: CF-03 for staff, CF-01 for patients and anonymous visitors */
export async function ViewerHeader() {
  const { session } = await getViewer();
  return session && session.account.role !== "PATIENT" ? <StaffFrameHeader /> : <PatientFrameHeader />;
}
