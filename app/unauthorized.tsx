// spec-screen: ER-05
// Session expired or revoked (PI013). Always CF-01 with ログイン / 会員登録 (Q6); the requested URL stays the target at P02.
import Link from "next/link";
import { ErrorBlock } from "@/components/frame/ErrorBlock";
import { PatientFrameHeader } from "@/components/frame/Frames";
import { getViewer } from "@/lib/frame/data";
import { t } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export default async function Unauthorized() {
  const { lang } = await getViewer();
  return (
    <>
      <PatientFrameHeader anonymous />
      <ErrorBlock icon="clock" tone="grey" title={label("er05Title", lang)} message={t("PI013", lang)} testId="er05">
        <div className="acts">
          {/* P02 reads the target itself (F9-03, event 23): the current URL is the one that was refused */}
          <Link className="btn bp" href="/login">{label("loginAction", lang)}</Link>
        </div>
        <p className="xs mut">{label("er05Note", lang)}</p>
      </ErrorBlock>
    </>
  );
}
