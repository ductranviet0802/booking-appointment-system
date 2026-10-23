// ER-01 / ER-03 / ER-05. The root special files (app/not-found.tsx …) draw them with their frame header; the copies in the
// route groups draw them bare, because Next renders a group's boundary inside the group layout, which already draws the frame.
import Link from "next/link";
import { ErrorBlock } from "@/components/frame/ErrorBlock";
import { PatientFrameHeader, StaffFrameHeader, ViewerHeader } from "@/components/frame/Frames";
import { currentPath, loginUrlFor } from "@/lib/auth/context";
import { getViewer } from "@/lib/frame/data";
import { t } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

/** Unknown URL, or a record outside the viewer's scope (no disclosure). CF-01 for patients / anonymous, CF-03 for staff. */
export async function Er01({ header }: { header: boolean }) {
  const { lang } = await getViewer();
  return (
    <>
      {header && <ViewerHeader />}
      <ErrorBlock icon="search" tone="grey" title={label("er01Title", lang)} message={t("PE091", lang)} testId="er01" inFrame={!header}>
        <div className="acts">
          <Link className="btn bp" href="/">{label("toTop", lang)}</Link>
        </div>
      </ErrorBlock>
    </>
  );
}

/** Staff: the role lacks the screen or the clinic (SE091). CF-03, Japanese only, link to S01. */
export function Er03({ header }: { header: boolean }) {
  return (
    <>
      {header && <StaffFrameHeader />}
      <ErrorBlock icon="lock" tone="amber" title={label("er03Title", "ja")} message={t("SE091", "ja")} testId="er03" inFrame={!header}>
        <div className="acts">
          <Link className="btn bp" href="/staff/ledger">{label("toLedger", "ja")}</Link>
        </div>
      </ErrorBlock>
    </>
  );
}

/** Session expired or revoked (PI013). Always CF-01 with ログイン / 会員登録 (Q6); the requested URL stays the target at P02. */
export async function Er05({ header }: { header: boolean }) {
  const { lang } = await getViewer();
  const loginHref = loginUrlFor(await currentPath());
  return (
    <>
      {header && <PatientFrameHeader anonymous />}
      <ErrorBlock icon="clock" tone="grey" title={label("er05Title", lang)} message={t("PI013", lang)} testId="er05" inFrame={!header}>
        <div className="acts">
          {/* the login guard keeps the refused URL as the target (F9-03, event 12-1); plain <a>: a route handler, not a page */}
          <a className="btn bp" href={loginHref}>{label("loginAction", lang)}</a>
        </div>
        <p className="xs mut">{label("er05Note", lang)}</p>
      </ErrorBlock>
    </>
  );
}
