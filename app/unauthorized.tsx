// spec-screen: ER-05
// Session expired or revoked (PI013). Always CF-01 with ログイン / 会員登録 (Q6); the requested URL stays the target at P02.
import { ErrorBlock } from "@/components/frame/ErrorBlock";
import { PatientFrameHeader } from "@/components/frame/Frames";
import { currentPath, loginUrlFor } from "@/lib/auth/context";
import { getViewer } from "@/lib/frame/data";
import { t } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export default async function Unauthorized() {
  const { lang } = await getViewer();
  const loginHref = loginUrlFor(await currentPath());
  return (
    <>
      <PatientFrameHeader anonymous />
      <ErrorBlock icon="clock" tone="grey" title={label("er05Title", lang)} message={t("PI013", lang)} testId="er05">
        <div className="acts">
          {/* the login guard keeps the refused URL as the target (F9-03, event 12-1); plain <a>: a route handler, not a page */}
          <a className="btn bp" href={loginHref}>{label("loginAction", lang)}</a>
        </div>
        <p className="xs mut">{label("er05Note", lang)}</p>
      </ErrorBlock>
    </>
  );
}
