// spec-screen: ER-01
// Unknown URL, or a record outside the viewer's scope (no disclosure). CF-01 for patients / anonymous, CF-03 for staff.
import Link from "next/link";
import { ErrorBlock } from "@/components/frame/ErrorBlock";
import { ViewerHeader } from "@/components/frame/Frames";
import { getViewer } from "@/lib/frame/data";
import { t } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export default async function NotFound() {
  const { lang } = await getViewer();
  return (
    <>
      <ViewerHeader />
      <ErrorBlock icon="search" tone="grey" title={label("er01Title", lang)} message={t("PE091", lang)} testId="er01">
        <div className="acts">
          <Link className="btn bp" href="/">{label("toTop", lang)}</Link>
        </div>
      </ErrorBlock>
    </>
  );
}
