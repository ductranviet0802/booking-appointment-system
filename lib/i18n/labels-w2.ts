// UI labels of P14 / P15 / P16 (slot w2). ja from the specs / images, en / vi from 07 where it has the term; the rest are
// vendor drafts (marked "draft") until the BA reviews them.
import type { Lang, Params } from "./index";

type Row = { ja: string; en: string; vi: string };

const L = {
  // 07 §2 status labels (patient UI) and 要調整 (07 §1)
  stRESERVED: { ja: "予約済", en: "Booked", vi: "Đã đặt" },
  stCHECKED_IN: { ja: "来院済", en: "Visited", vi: "Đã khám" },
  stNO_SHOW: { ja: "無断キャンセル", en: "Missed", vi: "Không đến" },
  stCANCELED: { ja: "キャンセル済", en: "Cancelled", vi: "Đã hủy" },
  stPENDING: { ja: "確認中", en: "Being confirmed", vi: "Đang xác nhận" },
  stADJUST: { ja: "要調整", en: "Needs rescheduling", vi: "Cần sắp xếp lại" }, // vi 07 §1; en draft
  relSELF: { ja: "本人", en: "Self", vi: "Bản thân" }, // 07 §1 relation tags
  // shared item labels (images)
  dateTime: { ja: "日時", en: "Date and time", vi: "Ngày giờ" }, // draft en/vi
  clinic: { ja: "クリニック", en: "Clinic", vi: "Phòng khám" }, // 07 §1 term
  deptVisit: { ja: "診療科・診療区分", en: "Department / visit type", vi: "Khoa / loại khám" }, // draft en/vi
  doctor: { ja: "担当医", en: "Doctor", vi: "Bác sĩ" }, // draft en/vi
  person: { ja: "受診する方", en: "Patient", vi: "Người khám" }, // draft en/vi
  bringHeading: { ja: "持ち物・注意事項", en: "What to bring / notes", vi: "Mang theo / lưu ý" }, // draft en/vi
  bringPrefix: { ja: "持ち物:", en: "Bring:", vi: "Mang theo:" }, // draft en/vi
  // P14
  stepsAria: { ja: "予約の手順", en: "Booking steps", vi: "Các bước đặt lịch" }, // draft
  stepSelect: { ja: "選択", en: "Select", vi: "Chọn" }, // draft en/vi
  stepQuestionnaire: { ja: "問診", en: "Questionnaire", vi: "Phiếu khám sơ bộ" }, // vi 07 §1; en draft
  stepConfirm: { ja: "確認", en: "Confirm", vi: "Xác nhận" }, // draft en/vi
  stepDone: { ja: "完了", en: "Done", vi: "Hoàn tất" }, // draft en/vi
  bookingNoPhone: { ja: "予約番号（お電話の際にお伝えください）", en: "Booking number (please quote it when you call)", vi: "Mã lịch hẹn (vui lòng cho biết khi gọi điện)" }, // draft en/vi
  copy: { ja: "コピー", en: "Copy", vi: "Sao chép" }, // draft en/vi
  copied: { ja: "コピーしました", en: "Copied", vi: "Đã sao chép" }, // draft (P14 Q9 b A)
  viewBooking: { ja: "予約内容を見る", en: "View booking", vi: "Xem lịch hẹn" }, // draft en/vi
  clinicGuide: { ja: "クリニック案内", en: "Clinic information", vi: "Thông tin phòng khám" }, // as labels.ts clinicInfoHeading
  // P15
  bookingsTitle: { ja: "予約一覧", en: "My bookings", vi: "Lịch hẹn của tôi" }, // 07 §1
  tabUpcoming: { ja: "予約中", en: "Upcoming", vi: "Sắp tới" }, // 07 §2
  tabPast: { ja: "受診履歴", en: "Past visits", vi: "Lịch sử khám" }, // 07 §2
  tabCanceled: { ja: "キャンセル", en: "Cancelled", vi: "Đã hủy" }, // 07 §2
  tabsAria: { ja: "予約の種類", en: "Booking tabs", vi: "Loại lịch hẹn" }, // draft
  colClinicDept: { ja: "クリニック・診療科", en: "Clinic / department", vi: "Phòng khám / khoa" }, // draft en/vi
  colVisitType: { ja: "診療区分", en: "Visit type", vi: "Loại khám" }, // draft en/vi
  colStatus: { ja: "状態", en: "Status", vi: "Trạng thái" }, // draft en/vi
  bookingNo: { ja: "予約番号", en: "Booking number", vi: "Mã lịch hẹn" }, // vi 07 §1; en draft
  more: { ja: "もっと見る", en: "Show more", vi: "Xem thêm" }, // draft en/vi
  book: { ja: "予約する", en: "Book", vi: "Đặt lịch" }, // 07 §3
  // P16
  detailTitle: { ja: "予約詳細", en: "Booking details", vi: "Chi tiết lịch hẹn" }, // draft en/vi
  price: { ja: "料金（税込）", en: "Price (incl. tax)", vi: "Giá (đã gồm thuế)" }, // draft en/vi
  notes: { ja: "ご要望・症状", en: "Requests / symptoms", vi: "Yêu cầu / triệu chứng" }, // draft en/vi
  none: { ja: "なし", en: "None", vi: "Không có" }, // draft en/vi
  changeBtn: { ja: "予約を変更する", en: "Change booking", vi: "Thay đổi lịch hẹn" }, // 07 §3
  cancelBtn: { ja: "キャンセルする", en: "Cancel booking", vi: "Hủy lịch hẹn" }, // 07 §3
  callBtn: { ja: "{phone} に電話", en: "Call {phone}", vi: "Gọi {phone}" }, // draft en/vi
  cancelSheetTitle: { ja: "キャンセルの理由", en: "Reason for cancelling", vi: "Lý do hủy" }, // draft en/vi
  confirmTitle: { ja: "予約をキャンセルしますか？", en: "Cancel this booking?", vi: "Hủy lịch hẹn này?" }, // draft en/vi
  reason: { ja: "理由", en: "Reason", vi: "Lý do" }, // draft en/vi
  reasonField: { ja: "キャンセル理由", en: "a reason", vi: "lý do" }, // {項目} of PE001 (P16 Q13); draft en/vi
  reasonOther: { ja: "理由（その他）", en: "Reason (other)", vi: "Lý do (khác)" }, // draft en/vi
  reasonOtherField: { ja: "理由（その他）", en: "the reason", vi: "lý do" }, // {項目} of PE001 / PE003; draft en/vi
  rRECOVERED: { ja: "体調が回復した", en: "I feel better", vi: "Tôi đã khỏe hơn" }, // draft en/vi
  rSCHEDULE: { ja: "都合が悪くなった", en: "I can no longer make it", vi: "Tôi không thể đến được" }, // draft en/vi
  rRESCHEDULE: { ja: "別の日に変更したい", en: "I want another day", vi: "Tôi muốn đổi sang ngày khác" }, // draft en/vi
  rOTHER: { ja: "その他", en: "Other", vi: "Khác" }, // 07 §1 relation "Other" wording
  rCLINIC: { ja: "医院の都合", en: "For reasons on the clinic's side", vi: "Vì lý do của phòng khám" }, // 07 §1 ja; en/vi draft
  otherText: { ja: "その他（{text}）", en: "Other ({text})", vi: "Khác ({text})" }, // P16 item 2; draft en/vi
  canceledOn: { ja: "{date}にキャンセルしました（理由: {reason}）", en: "Cancelled on {date} (reason: {reason})", vi: "Đã hủy ngày {date} (lý do: {reason})" }, // draft en/vi
  counter: { ja: "{n}/200", en: "{n}/200", vi: "{n}/200" },
  // PI051 default 電話案内文 (04 PI051 note) when the clinic has no booking_policies row yet
  phoneMessageDefault: {
    ja: "Webでの変更・キャンセルは受付期限を過ぎました。お手数ですがお電話でご連絡ください。",
    en: "Online changes and cancellations are closed for this booking. Please call us.",
    vi: "Đã hết hạn thay đổi hoặc hủy trực tuyến cho lịch hẹn này. Vui lòng gọi điện cho chúng tôi.",
  },
} satisfies Record<string, Row>;

export type W2Key = keyof typeof L;

export function w2(key: W2Key, lang: Lang, params: Params = {}): string {
  return L[key][lang].replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
