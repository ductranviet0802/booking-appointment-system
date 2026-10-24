// UI labels of the common frames (_common). ja from the spec / mocks, en / vi from 07 §1 / §3 where the glossary has them;
// the rest are vendor drafts (marked "draft") until the BA reviews them (_common Q11).
import type { Lang, Params } from "./index";

type Row = { ja: string; en: string; vi: string };

const L = {
  // CF-01
  noPreference: { ja: "指名なし（当日の担当医）", en: "No preference (doctor on duty)", vi: "Không chỉ định (bác sĩ trực hôm đó)" }, // F4-04, 04 §6.1; en/vi draft
  calPrev: { ja: "前月", en: "Previous month", vi: "Tháng trước" }, // shared date picker; en/vi draft
  calNext: { ja: "翌月", en: "Next month", vi: "Tháng sau" }, // en/vi draft
  calOpen: { ja: "カレンダーから選ぶ", en: "Choose from calendar", vi: "Chọn từ lịch" }, // en/vi draft
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
    ja: "受付は{bands} まで",
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
  // P02–P07 (accounts). ja from the specs / images; en / vi from 07 where it has the term, else drafts.
  fEmail: { ja: "メールアドレス", en: "E-mail address", vi: "Địa chỉ email" }, // 07
  fPassword: { ja: "パスワード", en: "Password", vi: "Mật khẩu" }, // draft en/vi
  fPasswordConfirm: { ja: "パスワード（確認）", en: "Password (confirm)", vi: "Mật khẩu (xác nhận)" }, // draft
  showPassword: { ja: "パスワードを表示", en: "Show password", vi: "Hiện mật khẩu" }, // draft
  pwRule: { ja: "8〜64文字、英字と数字をそれぞれ1文字以上", en: "8–64 characters, at least one letter and one number", vi: "8–64 ký tự, ít nhất một chữ cái và một chữ số" }, // draft
  nameType: { ja: "氏名の種類", en: "Name type", vi: "Loại họ tên" }, // draft
  nameJp: { ja: "日本語氏名", en: "Japanese name", vi: "Họ tên tiếng Nhật" }, // draft
  nameRomaji: { ja: "ローマ字氏名", en: "Name in Latin letters", vi: "Họ tên bằng chữ Latinh" }, // vi 07; en draft
  nameGroup: { ja: "氏名", en: "Name", vi: "Họ tên" }, // draft
  familyName: { ja: "姓", en: "Family name", vi: "Họ" }, // vi 07; en draft
  givenName: { ja: "名", en: "Given name", vi: "Tên" }, // vi 07; en draft
  kanaGroup: { ja: "フリガナ", en: "Reading (furigana)", vi: "Cách đọc (furigana)" }, // vi 07; en draft
  familyNameKana: { ja: "フリガナ（セイ）", en: "Reading of family name", vi: "Cách đọc họ" }, // draft
  givenNameKana: { ja: "フリガナ（メイ）", en: "Reading of given name", vi: "Cách đọc tên" }, // draft
  kanaSei: { ja: "セイ", en: "Family", vi: "Họ" }, // draft
  kanaMei: { ja: "メイ", en: "Given", vi: "Tên" }, // draft
  kanaHint: { ja: "フリガナは全角カタカナで入力してください。", en: "Enter the reading in full-width katakana.", vi: "Nhập cách đọc bằng katakana toàn độ rộng." }, // draft
  birthDate: { ja: "生年月日", en: "Date of birth", vi: "Ngày sinh" }, // 07
  yearOpt: { ja: "{y}年", en: "{y}", vi: "{y}" },
  monthOpt: { ja: "{m}月", en: "{m}", vi: "Tháng {m}" }, // draft
  dayOpt: { ja: "{d}日", en: "{d}", vi: "{d}" },
  yearAria: { ja: "年", en: "Year", vi: "Năm" }, // draft
  monthAria: { ja: "月", en: "Month", vi: "Tháng" }, // draft
  dayAria: { ja: "日", en: "Day", vi: "Ngày" }, // draft
  choose: { ja: "選択してください", en: "Please select", vi: "Vui lòng chọn" }, // draft
  sex: { ja: "性別", en: "Sex", vi: "Giới tính" }, // 07
  male: { ja: "男性", en: "Male", vi: "Nam" }, // 07
  female: { ja: "女性", en: "Female", vi: "Nữ" }, // 07
  sexNote: { ja: "保険証の記載のとおり", en: "As on your health insurance card", vi: "Theo thẻ bảo hiểm y tế" }, // draft
  postcode: { ja: "郵便番号", en: "Postcode", vi: "Mã bưu chính" }, // 07
  postcodeHelp: { ja: "入力すると住所を自動で入力します", en: "The address is filled in automatically", vi: "Địa chỉ sẽ được điền tự động" }, // draft
  postcodeSearching: { ja: "住所を検索中…", en: "Looking up the address…", vi: "Đang tìm địa chỉ…" }, // draft
  prefecture: { ja: "都道府県", en: "Prefecture", vi: "Tỉnh/thành phố" }, // 07
  city: { ja: "市区町村", en: "City / ward / town", vi: "Quận/huyện/thành phố" }, // 07
  town: { ja: "町域", en: "Area", vi: "Khu vực" }, // draft
  townOther: { ja: "その他（直接入力）", en: "Other (enter directly)", vi: "Khác (nhập trực tiếp)" }, // draft
  addressLine: { ja: "番地", en: "Street number", vi: "Số nhà" }, // draft
  building: { ja: "建物名・部屋番号", en: "Building and room number", vi: "Tên tòa nhà và số phòng" }, // draft
  buildingPh: { ja: "○○マンション 101号室", en: "○○ Mansion 101", vi: "○○ Mansion 101" }, // draft
  phone: { ja: "電話番号", en: "Phone number", vi: "Số điện thoại" }, // 07
  phoneHelp: { ja: "ハイフンなしでも入力できます。", en: "You can enter it without hyphens.", vi: "Có thể nhập không cần dấu gạch ngang." }, // draft
  phonePh: { ja: "例: 090-1234-5678", en: "e.g. 090-1234-5678", vi: "Ví dụ: 090-1234-5678" }, // draft
  optional: { ja: "任意", en: "Optional", vi: "Không bắt buộc" }, // draft
  addressGroup: { ja: "住所", en: "Address", vi: "Địa chỉ" }, // draft
  addressContact: { ja: "住所・連絡先", en: "Address and contact", vi: "Địa chỉ và liên hệ" }, // draft
  loginInfo: { ja: "ログイン情報", en: "Login details", vi: "Thông tin đăng nhập" }, // draft
  selfInfo: { ja: "ご本人の情報", en: "Your details", vi: "Thông tin của bạn" }, // draft
  consentHeading: { ja: "同意事項", en: "Agreements", vi: "Đồng ý" }, // draft
  agreePre: { ja: "", en: "I agree to the ", vi: "Tôi đồng ý với " }, // draft
  agreeTermsPost: { ja: "に同意する", en: "", vi: "" },
  agreePrivacyPost: {
    ja: "に同意し、問診などの要配慮個人情報の取得に同意する",
    en: " and to the collection of sensitive personal information such as questionnaire answers",
    vi: " và đồng ý thu thập thông tin cá nhân nhạy cảm như câu trả lời phiếu hỏi bệnh",
  }, // draft en/vi
  newTabNote: { ja: "リンクは新しいタブで開きます。", en: "Links open in a new tab.", vi: "Liên kết mở trong tab mới." }, // draft
  registerLead: {
    ja: "ご本人の情報を登録します。ご家族は登録後にマイページから追加できます。",
    en: "Register your own details. You can add family members on My page afterwards.",
    vi: "Đăng ký thông tin của bạn. Bạn có thể thêm thành viên gia đình tại Trang của tôi sau khi đăng ký.",
  }, // draft en/vi
  registerBtn: { ja: "登録する", en: "Register", vi: "Đăng ký" }, // 07 §3
  registering: { ja: "登録しています…", en: "Registering…", vi: "Đang đăng ký…" }, // draft
  haveAccount: { ja: "アカウントをお持ちの方は", en: "Already have an account? ", vi: "Đã có tài khoản? " }, // draft
  loginHere: { ja: "ログインはこちら", en: "Log in here", vi: "Đăng nhập tại đây" }, // draft
  sentHeading: { ja: "確認メールを送信しました", en: "We have sent a confirmation e-mail", vi: "Đã gửi email xác nhận" }, // draft
  spamHint: {
    ja: "メールが届かない場合は、迷惑メールフォルダをご確認ください。",
    en: "If the e-mail does not arrive, please check your spam folder.",
    vi: "Nếu không nhận được email, vui lòng kiểm tra thư mục thư rác.",
  }, // draft
  sendBtn: { ja: "送信する", en: "Send", vi: "Gửi" }, // 07 §3
  // P02
  loggingIn: { ja: "ログインしています…", en: "Logging in…", vi: "Đang đăng nhập…" }, // draft
  forgotLink: { ja: "パスワードを忘れた方", en: "Forgot your password?", vi: "Quên mật khẩu?" }, // vi spec item 7; en draft
  firstTime: { ja: "初めての方", en: "New here?", vi: "Lần đầu sử dụng?" }, // draft
  firstTimeLink: { ja: "初めての方: 会員登録", en: "New here? Register", vi: "Lần đầu sử dụng? Đăng ký" }, // draft
  registerPitch: {
    ja: "会員登録すると、Web予約・予約の確認・変更ができます。",
    en: "Register to book online and to check or change your bookings.",
    vi: "Đăng ký để đặt lịch trực tuyến và xem hoặc thay đổi lịch hẹn.",
  }, // draft
  staffNote: { ja: "スタッフの方も同じ画面からログインします。", en: "Staff log in on this screen too.", vi: "Nhân viên cũng đăng nhập tại màn hình này." }, // draft
  resendBtn: { ja: "確認メールを再送する", en: "Resend the confirmation e-mail", vi: "Gửi lại email xác nhận" }, // draft
  // P04 / P05
  resetTitle: { ja: "パスワードの再設定", en: "Reset your password", vi: "Đặt lại mật khẩu" }, // vi 07; en draft
  forgotLead: {
    ja: "ご登録のメールアドレスを入力してください。パスワード再設定用のリンクをお送りします。",
    en: "Enter your registered e-mail address. We will send you a link to reset your password.",
    vi: "Nhập địa chỉ email đã đăng ký. Chúng tôi sẽ gửi liên kết để đặt lại mật khẩu.",
  }, // draft
  mailSent: { ja: "メールを送信しました", en: "E-mail sent", vi: "Đã gửi email" }, // draft
  backToLogin: { ja: "ログイン画面へ戻る", en: "Back to login", vi: "Quay lại đăng nhập" }, // draft
  newPwTitle: { ja: "新しいパスワードの設定", en: "Set a new password", vi: "Đặt mật khẩu mới" }, // draft
  targetPrefix: { ja: "対象:", en: "Account:", vi: "Tài khoản:" }, // draft
  newPassword: { ja: "新しいパスワード", en: "New password", vi: "Mật khẩu mới" }, // draft
  newPasswordConfirm: { ja: "新しいパスワード（確認）", en: "New password (confirm)", vi: "Mật khẩu mới (xác nhận)" }, // draft
  changeBtn: { ja: "変更する", en: "Change", vi: "Thay đổi" }, // draft
  changing: { ja: "変更しています…", en: "Changing…", vi: "Đang thay đổi…" }, // draft
  changeNote: {
    ja: "変更すると、ログイン中のすべての端末からログアウトします。",
    en: "After the change you are logged out on every device.",
    vi: "Sau khi thay đổi, bạn sẽ bị đăng xuất trên mọi thiết bị.",
  }, // draft
  applyAgain: { ja: "もう一度申し込む", en: "Request again", vi: "Yêu cầu lại" }, // draft
  // P06
  familyBtn: { ja: "家族を管理", en: "Manage family", vi: "Quản lý thành viên gia đình" }, // vi spec item 2; en draft
  secProfile: { ja: "プロフィール", en: "Profile", vi: "Hồ sơ" }, // draft
  secCards: { ja: "診察券番号", en: "Patient card numbers", vi: "Số thẻ khám bệnh" }, // vi 07; en draft
  secLangNotify: { ja: "表示言語・通知", en: "Language and notifications", vi: "Ngôn ngữ và thông báo" }, // draft
  pendingEmail: {
    ja: "確認待ち: {address}（リンクを開くと変更されます）",
    en: "Awaiting confirmation: {address} (changes when you open the link)",
    vi: "Đang chờ xác nhận: {address} (sẽ thay đổi khi bạn mở liên kết)",
  }, // draft en/vi
  pendingBadge: { ja: "確認待ちあり", en: "Pending", vi: "Đang chờ" }, // draft
  currentPassword: { ja: "現在のパスワード", en: "Current password", vi: "Mật khẩu hiện tại" }, // draft
  pwChangeBtn: { ja: "パスワードを変更する", en: "Change password", vi: "Đổi mật khẩu" }, // draft
  pwChangeHelp: {
    ja: "3項目を入力すると押せます（保存するとは別）",
    en: "Fill in all three fields to enable (separate from Save)",
    vi: "Nhập đủ 3 mục để bật (tách biệt với Lưu)",
  }, // draft; ja: spec 30-1 names the items 27–29
  displayLang: { ja: "表示言語", en: "Display language", vi: "Ngôn ngữ hiển thị" }, // draft
  notifyChannel: { ja: "通知方法", en: "Notification method", vi: "Phương thức thông báo" }, // draft
  chMAIL: { ja: "メール", en: "E-mail", vi: "Email" }, // draft
  chLINE: { ja: "LINE", en: "LINE", vi: "LINE" },
  chSMS: { ja: "SMS", en: "SMS", vi: "SMS" },
  smsAgree: { ja: "SMSでの通知を受け取ることに同意する", en: "I agree to receive notifications by SMS", vi: "Tôi đồng ý nhận thông báo qua SMS" }, // draft
  smsHint: { ja: "（SMSは電話番号宛て）", en: " (sent to your phone number)", vi: " (gửi tới số điện thoại)" }, // draft
  lineGroup: { ja: "LINE連携", en: "LINE link", vi: "Liên kết LINE" }, // draft
  lineLinked: { ja: "連携済み", en: "Linked", vi: "Đã liên kết" }, // draft
  lineNone: { ja: "未連携", en: "Not linked", vi: "Chưa liên kết" }, // draft
  lineNeedFriend: { ja: "友だち追加が必要です", en: "Please add us as a friend", vi: "Cần kết bạn" }, // draft
  lineLink: { ja: "LINEと連携する", en: "Link with LINE", vi: "Liên kết với LINE" }, // 07 §3
  lineUnlink: { ja: "LINE連携を解除", en: "Unlink LINE", vi: "Hủy liên kết LINE" }, // draft
  cardNoCol: { ja: "診察券番号（任意）", en: "Card number (optional)", vi: "Số thẻ khám bệnh (không bắt buộc)" }, // draft
  cardNo: { ja: "診察券番号", en: "Patient card number", vi: "Số thẻ khám bệnh" }, // 07 (en draft)
  cardState: { ja: "状態", en: "Status", vi: "Trạng thái" }, // draft
  confirmed: { ja: "確認済み", en: "Confirmed", vi: "Đã xác nhận" }, // draft
  unconfirmed: { ja: "未確認", en: "Unconfirmed", vi: "Chưa xác nhận" }, // draft
  unregistered: { ja: "未登録", en: "Not registered", vi: "Chưa đăng ký" }, // draft
  cardNote: {
    ja: "未確認: ご自身で入力した番号です。来院時にスタッフが確認します。",
    en: "Unconfirmed: a number you entered yourself. Staff will check it at your visit.",
    vi: "Chưa xác nhận: số do bạn tự nhập. Nhân viên sẽ kiểm tra khi bạn đến khám.",
  }, // draft
  saveBtn: { ja: "保存する", en: "Save", vi: "Lưu" }, // 07 §3
  withdrawHeading: { ja: "退会", en: "Close account", vi: "Xóa tài khoản" }, // vi 07; en draft
  withdrawNote: {
    ja: "退会すると、ご家族の情報を含めて利用できなくなります。今後の予約がある場合は退会できません。",
    en: "After closing your account you can no longer use it, including your family members' details. You cannot close it while you have upcoming bookings.",
    vi: "Sau khi xóa tài khoản, bạn không thể sử dụng nữa, kể cả thông tin gia đình. Không thể xóa khi còn lịch hẹn sắp tới.",
  }, // draft
  withdrawBtn: { ja: "退会する", en: "Close account", vi: "Xóa tài khoản" }, // vi 07; en draft
  withdrawTitle: { ja: "退会しますか？", en: "Close your account?", vi: "Xóa tài khoản?" }, // draft
  // P07
  familyTitle: { ja: "家族管理", en: "Family members", vi: "Thành viên gia đình" }, // vi 07; en draft
  familyLead: {
    ja: "ご家族の予約をあなたのアカウントから行えます。登録できるご家族は{n}人までです。",
    en: "You can book for your family from your account. You can register up to {n} family members.",
    vi: "Bạn có thể đặt lịch cho gia đình từ tài khoản của mình. Có thể đăng ký tối đa {n} thành viên.",
  }, // draft
  familyLeadShort: { ja: "登録できるご家族は{n}人までです。", en: "Up to {n} family members.", vi: "Tối đa {n} thành viên." }, // draft
  familyListHeading: { ja: "登録済みのご家族（{n}人）", en: "Registered family members ({n})", vi: "Thành viên đã đăng ký ({n})" }, // draft
  bornOn: { ja: "{y}年{m}月{d}日生", en: "Born {d}/{m}/{y}", vi: "Sinh ngày {d}/{m}/{y}" }, // draft en/vi
  editing: { ja: "編集中", en: "Editing", vi: "Đang sửa" }, // draft
  bookForMember: { ja: "この家族で予約", en: "Book for this person", vi: "Đặt lịch cho người này" }, // vi spec item 3; en draft
  edit: { ja: "編集", en: "Edit", vi: "Sửa" }, // draft
  delete: { ja: "削除", en: "Remove", vi: "Xóa" }, // draft
  addMember: { ja: "家族を追加する", en: "Add a family member", vi: "Thêm thành viên gia đình" }, // draft
  relation: { ja: "続柄", en: "Relationship", vi: "Quan hệ" }, // draft
  relCHILD: { ja: "子", en: "Child", vi: "Con" }, // 03 §2
  relSPOUSE: { ja: "配偶者", en: "Spouse", vi: "Vợ/Chồng" }, // 03 §2
  relPARENT: { ja: "親", en: "Parent", vi: "Cha/Mẹ" }, // 03 §2
  relOTHER: { ja: "その他", en: "Other", vi: "Khác" }, // 03 §2
  editHeading: { ja: "家族の情報を編集", en: "Edit family member", vi: "Sửa thông tin thành viên" }, // draft
  addPrefillHelp: { ja: "追加時はあなたの住所を初期表示", en: "Your address is filled in when adding", vi: "Địa chỉ của bạn được điền sẵn khi thêm" }, // draft
  deleteTitle: { ja: "{name}様を削除しますか？", en: "Remove {name}?", vi: "Xóa {name}?" }, // draft en/vi
  dupMember: {
    ja: "このご家族は既に登録されています。",
    en: "This family member is already registered.",
    vi: "Thành viên gia đình này đã được đăng ký.",
  }, // draft: no 04 id for P07 §6-1 "not registered twice" (question in the W2 report)
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
