// spec-screen: ER-04
// Planned maintenance (N-OPS-02): logo only, no menu, no login, no link. PI092 with {終了時刻} = maintenance_to in the F13-04 full style.
import { ErrorBlock } from "./ErrorBlock";
import { PatientFrameHeader } from "./Frames";
import { formatDateTime } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { label } from "@/lib/i18n/labels";

export async function MaintenanceScreen({ end, lang }: { end: Date; lang: Lang }) {
  return (
    <>
      <PatientFrameHeader logoOnly />
      <ErrorBlock
        icon="tool"
        tone="blue"
        title={label("er04Title", lang)}
        message={t("PI092", lang, { 終了時刻: formatDateTime(end, lang) })}
        testId="er04"
      />
    </>
  );
}
