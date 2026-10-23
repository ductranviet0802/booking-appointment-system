// spec-screen: ER-03
// Staff: the role lacks the screen or the clinic (SE091). CF-03, Japanese only, link to S01.
import Link from "next/link";
import { ErrorBlock } from "@/components/frame/ErrorBlock";
import { StaffFrameHeader } from "@/components/frame/Frames";
import { t } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export default function Forbidden() {
  return (
    <>
      <StaffFrameHeader />
      <ErrorBlock icon="lock" tone="amber" title={label("er03Title", "ja")} message={t("SE091", "ja")} testId="er03">
        <div className="acts">
          <Link className="btn bp" href="/staff/ledger">{label("toLedger", "ja")}</Link>
        </div>
      </ErrorBlock>
    </>
  );
}
