// Screen texts of P11 / P12 / P13 (slot w1). ja from the specs and layout images (image-only texts are spec text as drawn),
// en / vi from 07 §1–§3 where the glossary has them; "draft" = translated by the vendor until the BA reviews it.
import type { Lang, Params } from "./index";

type Row = { ja: string; en: string; vi: string };

const L = {
  // step display (P11 / P12 / P13 item 1)
  stepSelect: { ja: "選択", en: "Select", vi: "Chọn" }, // draft
  stepQuestionnaire: { ja: "問診", en: "Questionnaire", vi: "Phiếu khám sơ bộ" }, // vi 07 §1; en draft
  stepConfirm: { ja: "確認", en: "Confirm", vi: "Xác nhận" }, // draft
  stepDone: { ja: "完了", en: "Done", vi: "Hoàn tất" }, // draft
  stepsAria: { ja: "予約の手順", en: "Booking steps", vi: "Các bước đặt lịch" }, // draft
  stepCurrent: { ja: "（現在の手順）", en: " (current step)", vi: " (bước hiện tại)" }, // draft, screen readers
  // P11
  entryHeading: { ja: "予約日時を選ぶ", en: "Choose a date and time", vi: "Chọn ngày giờ" }, // image text; en/vi draft
  changeBefore: { ja: "変更前: {date} {time}〜（予約番号 {no}）", en: "Before: {date} {time} (booking no. {no})", vi: "Trước khi đổi: {date} {time} (mã đặt lịch {no})" }, // en/vi draft
  lockText: { ja: "変更できるのは担当医・日付・時間のみです", en: "Only the doctor, date and time can be changed", vi: "Chỉ có thể thay đổi bác sĩ, ngày và giờ" }, // image text; en/vi draft
  person: { ja: "受診する方", en: "Patient", vi: "Người khám" }, // draft
  clinic: { ja: "クリニック", en: "Clinic", vi: "Phòng khám" }, // draft
  department: { ja: "診療科", en: "Department", vi: "Chuyên khoa" }, // draft
  visitType: { ja: "診療区分", en: "Visit type", vi: "Loại khám" }, // vi 07 §1; en draft
  deptAndType: { ja: "診療科・区分", en: "Department / visit type", vi: "Chuyên khoa / loại khám" }, // image text; en/vi draft
  doctor: { ja: "担当医", en: "Doctor", vi: "Bác sĩ" }, // draft
  date: { ja: "日付", en: "Date", vi: "Ngày" }, // draft
  time: { ja: "時間", en: "Time", vi: "Giờ" }, // draft
  dateTime: { ja: "日時", en: "Date and time", vi: "Ngày giờ" }, // image text; en/vi draft
  notes: { ja: "ご要望・症状", en: "Requests / symptoms", vi: "Yêu cầu / triệu chứng" }, // draft
  notesPlaceholder: { ja: "症状やご要望があればご記入ください", en: "Enter any symptoms or requests", vi: "Nhập triệu chứng hoặc yêu cầu nếu có" }, // en/vi draft
  firstVisitSub: { ja: "はじめての方", en: "First visit", vi: "Lần đầu khám" }, // image text; en/vi draft
  noticeHeading: { ja: "持ち物・注意事項", en: "What to bring / notes", vi: "Đồ cần mang / lưu ý" }, // image text; en/vi draft
  noticePrefix: { ja: "持ち物:", en: "Bring:", vi: "Mang theo:" }, // image text; en/vi draft
  taxIncl: { ja: "（税込）", en: " (tax incl.)", vi: " (đã gồm thuế)" }, // draft
  relSELF: { ja: "本人", en: "Self", vi: "Bản thân" }, // 07 §1
  relCHILD: { ja: "子", en: "Child", vi: "Con" }, // 07 §1
  relSPOUSE: { ja: "配偶者", en: "Spouse", vi: "Vợ/Chồng" }, // 07 §1
  relPARENT: { ja: "親", en: "Parent", vi: "Cha/Mẹ" }, // 07 §1
  relOTHER: { ja: "その他", en: "Other", vi: "Khác" }, // 07 §1
  legendFree: { ja: "空きあり", en: "Available", vi: "Còn chỗ" }, // 07 §2
  legendFew: { ja: "残りわずか", en: "Few left", vi: "Sắp hết" }, // 07 §2
  legendFull: { ja: "満", en: "Full", vi: "Hết chỗ" }, // 07 §2
  legendClosed: { ja: "休診", en: "Closed", vi: "Nghỉ" }, // 07 §2
  calendarAria: { ja: "予約日のカレンダー", en: "Booking calendar", vi: "Lịch đặt hẹn" }, // draft
  nextFree: { ja: "次の空き", en: "Next available", vi: "Ngày trống tiếp theo" }, // 07 §3
  am: { ja: "午前", en: "Morning", vi: "Buổi sáng" }, // 07 §1
  pm: { ja: "午後", en: "Afternoon", vi: "Buổi chiều" }, // 07 §1
  optional: { ja: "任意", en: "Optional", vi: "Không bắt buộc" }, // image text; en/vi draft
  next: { ja: "次へ", en: "Next", vi: "Tiếp tục" }, // 07 §3
  nextToQuestionnaire: { ja: "次へ（問診へ）", en: "Next (questionnaire)", vi: "Tiếp tục (phiếu khám sơ bộ)" }, // draft
  nextToConfirm: { ja: "次へ（確認へ）", en: "Next (confirm)", vi: "Tiếp tục (xác nhận)" }, // draft
  selectedAt: { ja: "{date} {time}〜 を選択中", en: "Selected: {date} {time}", vi: "Đã chọn: {date} {time}" }, // en/vi draft
  quit: { ja: "予約を中止する", en: "Stop booking", vi: "Dừng đặt lịch" }, // image text; en/vi draft
  quitTitle: { ja: "予約を中止しますか？", en: "Stop this booking?", vi: "Dừng đặt lịch này?" }, // spec text; en/vi draft
  loading: { ja: "読み込み中", en: "Loading", vi: "Đang tải" }, // draft
  // P12
  questionnaireHeading: { ja: "問診票", en: "Questionnaire", vi: "Phiếu khám sơ bộ" }, // image text; vi 07 §1; en draft
  progress: { ja: "回答状況 {done} / {total} 問", en: "Answered {done} / {total}", vi: "Đã trả lời {done} / {total} câu" }, // en/vi draft
  deptBlock: { ja: "{dept}の質問", en: "{dept} questions", vi: "Câu hỏi {dept}" }, // en/vi draft
  commonBlock: { ja: "共通の質問", en: "General questions", vi: "Câu hỏi chung" }, // en/vi draft
  summaryLine: { ja: "{name} 様 ／ {clinic} {dept} {type} ／ {date} {time}〜", en: "{name} / {clinic} {dept} {type} / {date} {time}", vi: "{name} / {clinic} {dept} {type} / {date} {time}" }, // en/vi draft
  back: { ja: "戻る", en: "Back", vi: "Quay lại" }, // 07 §3
  // P13
  confirmHeading: { ja: "予約内容の確認", en: "Check your booking", vi: "Kiểm tra lịch hẹn" }, // image text; en/vi draft
  changeContent: { ja: "変更内容", en: "Changes", vi: "Nội dung thay đổi" }, // image text; en/vi draft
  price: { ja: "料金（税込）", en: "Fee (tax incl.)", vi: "Phí (đã gồm thuế)" }, // draft
  questionnaireDone: { ja: "入力済み", en: "Completed", vi: "Đã nhập" }, // image text; en/vi draft
  questionnaireKept: { ja: "問診: 回答済み（変更なし）", en: "Questionnaire: answered (unchanged)", vi: "Phiếu khám sơ bộ: đã trả lời (không đổi)" }, // image text; en/vi draft
  none: { ja: "なし", en: "None", vi: "Không có" }, // draft
  confirmBooking: { ja: "予約を確定する", en: "Confirm booking", vi: "Xác nhận đặt lịch" }, // 07 §3
  confirmChange: { ja: "変更を確定する", en: "Confirm change", vi: "Xác nhận thay đổi" }, // 07 §3
  confirmingBooking: { ja: "予約を確定しています…", en: "Confirming your booking…", vi: "Đang xác nhận đặt lịch…" }, // image text; en/vi draft
  confirmingChange: { ja: "変更を確定しています…", en: "Confirming the change…", vi: "Đang xác nhận thay đổi…" }, // Q13 b A; en/vi draft
  backToQuestionnaire: { ja: "戻る（問診へ）", en: "Back (to questionnaire)", vi: "Quay lại (phiếu khám sơ bộ)" }, // P13 Q12 b A
  backToDateTime: { ja: "戻る（日時選択へ）", en: "Back (to date and time)", vi: "Quay lại (chọn ngày giờ)" }, // P13 Q12 b A
  changeTitle: { ja: "予約を変更しますか？", en: "Change this booking?", vi: "Thay đổi lịch hẹn này?" }, // spec text; en/vi draft
  phoneDefault: {
    ja: "Webでの変更・キャンセルは受付期限を過ぎました。お手数ですがお電話でご連絡ください。",
    en: "Online changes and cancellations are closed for this booking. Please call us.",
    vi: "Đã hết hạn thay đổi hoặc hủy trực tuyến cho lịch hẹn này. Vui lòng gọi điện cho chúng tôi.",
  }, // 04 PI051 default
} satisfies Record<string, Row>;

export type W1Key = keyof typeof L;

export function lw1(key: W1Key, lang: Lang, params: Params = {}): string {
  return L[key][lang].replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
