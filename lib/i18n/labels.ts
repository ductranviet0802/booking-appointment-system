// UI labels of the common frames (_common). ja from the spec / mocks, en / vi from 07 §1 / §3 where the glossary has them;
// the rest are vendor drafts (marked "draft") until the BA reviews them (_common Q11).
import type { Lang, Params } from "./index";

type Row = { ja: string; en: string; vi: string };

const L = {
  // CF-01
  navTop: { ja: "トップ", en: "Home", vi: "Trang chủ" }, // draft en/vi
  navDoctors: { ja: "医師検索", en: "Find a doctor", vi: "Tìm bác sĩ" }, // en draft; vi from spec item 3
  navClinics: { ja: "クリニック案内", en: "Clinics", vi: "Thông tin phòng khám" }, // en draft; vi from spec item 4
  navBookings: { ja: "予約一覧", en: "My bookings", vi: "Lịch hẹn của tôi" }, // 07 §1
  navMypage: { ja: "マイページ", en: "My page", vi: "Trang của tôi" }, // 07 §1
  menuNav: { ja: "グローバルメニュー", en: "Main menu", vi: "Menu chính" }, // draft
  drawerTitle: { ja: "メニュー", en: "Menu", vi: "Menu" }, // draft
  openMenu: { ja: "メニューを開く", en: "Open menu", vi: "Mở menu" }, // draft
  closeMenu: { ja: "メニューを閉じる", en: "Close menu", vi: "Đóng menu" }, // draft
  langHeading: { ja: "言語 / Language", en: "言語 / Language", vi: "言語 / Language" }, // spec text as drawn
  langAria: { ja: "言語", en: "Language", vi: "Ngôn ngữ" }, // draft
  lockLegend: { ja: "鍵アイコン＝ログインが必要", en: "Lock icon = login required", vi: "Biểu tượng khóa = cần đăng nhập" }, // draft en/vi
  lockAria: { ja: "ログインが必要", en: "Login required", vi: "Cần đăng nhập" }, // draft
  login: { ja: "ログイン", en: "Log in", vi: "Đăng nhập" }, // 07 §1 / §3
  register: { ja: "会員登録", en: "Register", vi: "Đăng ký" }, // vi 07 §1; en draft
  logout: { ja: "ログアウト", en: "Log out", vi: "Đăng xuất" }, // 07 §1
  nameSuffix: { ja: "様", en: "", vi: "" }, // 04 §6.1: 様 in ja only
  // CF-02
  footerNav: { ja: "フッター", en: "Footer", vi: "Chân trang" }, // draft
  terms: { ja: "利用規約", en: "Terms of Use", vi: "Điều khoản sử dụng" }, // 07 §1
  privacy: { ja: "プライバシーポリシー", en: "Privacy Policy", vi: "Chính sách bảo mật" }, // 07 §1
  newTab: { ja: "（新しいタブで開く）", en: " (opens in a new tab)", vi: " (mở trong tab mới)" }, // draft, screen readers
  copyright: { ja: "© {year} {group}. All rights reserved.", en: "© {year} {group}. All rights reserved.", vi: "© {year} {group}. Bảo lưu mọi quyền." }, // ja/en as drawn; vi draft
  // CF-04
  consentTitle: { ja: "利用規約・プライバシーポリシー改定のお知らせ", en: "Notice of updated Terms of Use and Privacy Policy", vi: "Thông báo cập nhật Điều khoản sử dụng và Chính sách bảo mật" }, // draft en/vi
  readPre: { ja: "", en: "Read the ", vi: "Đọc " }, // draft; hidden on mobile
  readPost: { ja: "を読む", en: "", vi: "" },
  versionOf: { ja: "（第{version}版）", en: " (version {version})", vi: " (phiên bản {version})" }, // draft en/vi
  agreeTerms: { ja: "利用規約に同意する", en: "I agree to the Terms of Use", vi: "Tôi đồng ý với Điều khoản sử dụng" }, // draft en/vi
  agreePrivacy: {
    ja: "プライバシーポリシーに同意する（要配慮個人情報の取得を含む）",
    en: "I agree to the Privacy Policy (including the collection of sensitive personal information)",
    vi: "Tôi đồng ý với Chính sách bảo mật (bao gồm việc thu thập thông tin cá nhân nhạy cảm)",
  }, // draft en/vi
  agreeContinue: { ja: "同意して続ける", en: "Agree and continue", vi: "Đồng ý và tiếp tục" }, // draft
  declineLogout: { ja: "同意せずログアウト", en: "Log out without agreeing", vi: "Đăng xuất mà không đồng ý" }, // draft
  // ER
  er01Title: { ja: "ページが見つかりません", en: "Page not found", vi: "Không tìm thấy trang" }, // draft
  er02Title: { ja: "システムエラー", en: "System error", vi: "Lỗi hệ thống" }, // draft
  er03Title: { ja: "権限がありません", en: "権限がありません", vi: "権限がありません" }, // staff, ja only
  er04Title: { ja: "メンテナンス中", en: "Under maintenance", vi: "Đang bảo trì" }, // draft
  er05Title: { ja: "セッションが切れました", en: "Your session has expired", vi: "Phiên đăng nhập đã hết hạn" }, // draft
  toTop: { ja: "トップへ", en: "Back to top", vi: "Về trang chủ" }, // draft
  toLedger: { ja: "予約台帳へ", en: "予約台帳へ", vi: "予約台帳へ" }, // staff, ja only
  reload: { ja: "再読み込み", en: "Reload", vi: "Tải lại" }, // draft
  loginAction: { ja: "ログインする", en: "Log in", vi: "Đăng nhập" }, // 07 §3
  er05Note: { ja: "ログイン後、元のページへ戻ります", en: "After you log in, you will return to the page you were on.", vi: "Sau khi đăng nhập, bạn sẽ quay lại trang trước đó." }, // draft en/vi
  // patterns
  required: { ja: "必須", en: "Required", vi: "Bắt buộc" }, // spec item 37
  summaryHeading: { ja: "{n}件の入力エラーがあります", en: "There are {n} input errors", vi: "Có {n} lỗi nhập liệu" }, // draft en/vi
  summaryHeadingOne: { ja: "{n}件の入力エラーがあります", en: "There is 1 input error", vi: "Có 1 lỗi nhập liệu" }, // draft en/vi
  busy: { ja: "送信中…", en: "Sending…", vi: "Đang gửi…" }, // ja as drawn; en/vi draft
  close: { ja: "閉じる", en: "Close", vi: "Đóng" }, // 07 §3
  yes: { ja: "はい", en: "Yes", vi: "Có" }, // 07 §3
  no: { ja: "いいえ", en: "No", vi: "Không" }, // 07 §3
  cancel: { ja: "キャンセル", en: "キャンセル", vi: "キャンセル" }, // staff dialogs (ja only)
  // P01 / P08 / P09 / P10 (public browsing). ja as drawn in the layouts; en / vi from 07 where it has the term, else drafts.
  bookCta: { ja: "予約する", en: "Book an appointment", vi: "Đặt lịch" }, // draft en/vi
  findDoctor: { ja: "医師を探す", en: "Find a doctor", vi: "Tìm bác sĩ" }, // en draft; vi spec item 6
  detailMore: { ja: "詳しく", en: "Details", vi: "Chi tiết" }, // draft
  clinicListHeading: { ja: "クリニック一覧", en: "Our clinics", vi: "Danh sách phòng khám" }, // draft
  clinicDetail: { ja: "このクリニックの詳細", en: "Clinic details", vi: "Chi tiết phòng khám" }, // draft
  todayPrefix: { ja: "本日", en: "Today", vi: "Hôm nay" }, // draft
  todayClosed: { ja: "本日は休診日です", en: "Closed today", vi: "Hôm nay phòng khám nghỉ" }, // draft
  catchCopy: { ja: "24時間いつでもWeb予約", en: "Book online, any time of day", vi: "Đặt lịch trực tuyến 24 giờ mỗi ngày" }, // draft
  catchSub: {
    ja: "診療科・担当医・日時を選んで、そのまま予約できます。",
    en: "Choose a department, doctor and time, and book right away.",
    vi: "Chọn khoa, bác sĩ và thời gian rồi đặt lịch ngay.",
  }, // draft
  kwPlaceholder: { ja: "医師名・ふりがな・診療科", en: "Doctor name, department", vi: "Tên bác sĩ, khoa" }, // draft
  kwHelp: {
    ja: "空欄のまま検索すると全医師を表示します。",
    en: "Leave the box empty to list all doctors.",
    vi: "Để trống ô tìm kiếm để xem tất cả bác sĩ.",
  }, // draft
  maintPrefix: { ja: "メンテナンスのお知らせ:", en: "Maintenance notice:", vi: "Thông báo bảo trì:" }, // draft
  keyword: { ja: "キーワード", en: "Keyword", vi: "Từ khóa" }, // draft
  clinicLabel: { ja: "クリニック", en: "Clinic", vi: "Phòng khám" }, // 07 §1 term
  departmentLabel: { ja: "診療科", en: "Department", vi: "Khoa" }, // 07 §1 term
  languageLabel: { ja: "対応言語", en: "Languages spoken", vi: "Ngôn ngữ hỗ trợ" }, // 07 §1 term (en draft)
  allOption: { ja: "すべて", en: "All", vi: "Tất cả" }, // draft
  searchBtn: { ja: "検索する", en: "Search", vi: "Tìm kiếm" }, // 07 §3
  clearBtn: { ja: "条件をクリア", en: "Clear filters", vi: "Xóa bộ lọc" }, // 07 §3
  filterBtn: { ja: "条件で絞り込む", en: "Filters", vi: "Bộ lọc" }, // draft
  countText: { ja: "{total}件中 {from}〜{to}件を表示", en: "Showing {from}–{to} of {total}", vi: "Hiển thị {from}–{to} trên {total}" }, // draft
  prevPage: { ja: "前へ", en: "Previous", vi: "Trước" }, // draft
  nextPage: { ja: "次へ", en: "Next", vi: "Sau" }, // draft
  pagerAria: { ja: "ページ送り", en: "Pagination", vi: "Phân trang" }, // draft
  pageOf: { ja: "{page} / {pages}", en: "{page} / {pages}", vi: "{page} / {pages}" },
  seeClinics: { ja: "クリニック案内を見る", en: "View clinic information", vi: "Xem thông tin phòng khám" }, // draft
  doctorsHeading: { ja: "医師を探す", en: "Find a doctor", vi: "Tìm bác sĩ" }, // draft
  titleDIRECTOR: { ja: "院長", en: "Director", vi: "Viện trưởng" }, // 07 §1
  titleVICE_DIRECTOR: { ja: "副院長", en: "Vice-director", vi: "Phó viện trưởng" }, // 07 §1
  titleDOCTOR: { ja: "医師", en: "Doctor", vi: "Bác sĩ" }, // 07 §1
  titlePART_TIME: { ja: "非常勤医師", en: "Part-time doctor", vi: "Bác sĩ bán thời gian" }, // 07 §1
  wd0: { ja: "日", en: "Sun", vi: "CN" }, // draft en/vi
  wd1: { ja: "月", en: "Mon", vi: "Thứ Hai" },
  wd2: { ja: "火", en: "Tue", vi: "Thứ Ba" },
  wd3: { ja: "水", en: "Wed", vi: "Thứ Tư" },
  wd4: { ja: "木", en: "Thu", vi: "Thứ Năm" },
  wd5: { ja: "金", en: "Fri", vi: "Thứ Sáu" },
  wd6: { ja: "土", en: "Sat", vi: "Thứ Bảy" },
  sunHoliday: { ja: "日・祝", en: "Sun / Hol.", vi: "CN / Lễ" }, // draft
  holidayMark: { ja: "祝", en: "Holiday", vi: "Lễ" }, // draft
  bandAM: { ja: "午前", en: "Morning", vi: "Buổi sáng" }, // 07 §1
  bandPM: { ja: "午後", en: "Afternoon", vi: "Buổi chiều" }, // 07 §1
  openMark: { ja: "●", en: "●", vi: "●" },
  closedMark: { ja: "休", en: "Closed", vi: "Nghỉ" }, // 07 §2 (休診 / Closed / Nghỉ)
  openAria: { ja: "診療", en: "Open", vi: "Khám" }, // draft
  // P10
  clinicInfoHeading: { ja: "クリニック案内", en: "Clinic information", vi: "Thông tin phòng khám" }, // en draft; vi spec item 4
  switchClinicAria: { ja: "クリニックの切り替え", en: "Switch clinic", vi: "Chuyển phòng khám" }, // draft
  mapLink: { ja: "地図を見る", en: "View map", vi: "Xem bản đồ" }, // draft
  phoneBtn: { ja: "電話", en: "Call", vi: "Gọi" }, // draft
  accessLabel: { ja: "アクセス", en: "Access", vi: "Đường đi" }, // 07 §1
  hoursHeading: { ja: "診療時間", en: "Business hours", vi: "Giờ khám" }, // 07 §1
  receptionNote: {
    ja: "受付は{bands}まで",
    en: "Reception closes at {bands}",
    vi: "Ngừng tiếp nhận lúc {bands}",
  }, // draft; 07 §1 term for reception closing time
  receptionBand: { ja: "{band} {time}", en: "{band} {time}", vi: "{band} {time}" },
  receptionBefore: { ja: "（診療終了の{min}分前）", en: " ({min} min before closing)", vi: " ({min} phút trước giờ đóng cửa)" }, // draft
  closuresHeading: { ja: "休診日・臨時診療", en: "Closed days and special openings", vi: "Ngày nghỉ và khám bổ sung" }, // 07 §1 terms
  closuresCaption: { ja: "今後2か月", en: "Next 2 months", vi: "2 tháng tới" }, // draft
  closuresEmpty: { ja: "予定されている休診日はありません", en: "No closed days are scheduled.", vi: "Không có ngày nghỉ nào được lên lịch." }, // draft en/vi
  badgeClosed: { ja: "臨時休診", en: "Temporarily closed", vi: "Nghỉ đột xuất" }, // draft
  badgeHoliday: { ja: "休診", en: "Closed", vi: "Nghỉ" }, // 07 §2
  badgeAmOnly: { ja: "午前のみ", en: "Morning only", vi: "Chỉ buổi sáng" }, // draft
  badgePmOnly: { ja: "午後のみ", en: "Afternoon only", vi: "Chỉ buổi chiều" }, // draft
  badgeSpecial: { ja: "臨時診療", en: "Special opening", vi: "Khám bổ sung" }, // 07 §1 (en draft)
  noteAmClosed: { ja: "午前休診", en: "Closed in the morning", vi: "Nghỉ buổi sáng" }, // draft
  notePmClosed: { ja: "午後休診", en: "Closed in the afternoon", vi: "Nghỉ buổi chiều" }, // draft
  deptDoctorsHeading: { ja: "診療科・医師", en: "Departments and doctors", vi: "Khoa và bác sĩ" }, // draft
  bookAtClinic: { ja: "このクリニックで予約", en: "Book at this clinic", vi: "Đặt lịch tại phòng khám này" }, // draft
  // P09
  backToList: { ja: "医師一覧へ戻る", en: "Back to the doctor list", vi: "Quay lại danh sách bác sĩ" }, // draft
  bookWithDoctor: { ja: "この医師で予約", en: "Book with this doctor", vi: "Đặt lịch với bác sĩ này" }, // draft
  bookPair: { ja: "{clinic} {department}で予約", en: "Book: {clinic} – {department}", vi: "Đặt lịch: {clinic} – {department}" }, // draft en/vi
  scheduleHeading: { ja: "診療スケジュール", en: "Schedule", vi: "Lịch khám" }, // draft
  scheduleNote: { ja: "休診日・代診により変わることがあります", en: "May change on closed days or when a substitute doctor covers.", vi: "Có thể thay đổi vào ngày nghỉ hoặc khi có bác sĩ thay thế." }, // draft
  profileHeading: { ja: "経歴", en: "Background", vi: "Quá trình công tác" }, // draft
  qualificationsHeading: { ja: "資格・所属学会", en: "Qualifications and memberships", vi: "Chứng chỉ và hội chuyên môn" }, // draft
  dash: { ja: "—", en: "—", vi: "—" },
} satisfies Record<string, Row>;

export type LabelKey = keyof typeof L;

export function label(key: LabelKey, lang: Lang, params: Params = {}): string {
  return L[key][lang].replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Staff-only labels (CF-03, Japanese only) */
export const STAFF = {
  badge: "スタッフ",
  clinic: "クリニック",
  menuNav: "スタッフメニュー",
  menuOpen: "メニュー",
  readOnly: "閲覧",
  roles: { ADMIN: "管理者", RECEPTION: "受付", DOCTOR: "医師", PATIENT: "" } as Record<string, string>,
  logout: "ログアウト",
  cancel: "キャンセル",
  yes: "はい",
} as const;
