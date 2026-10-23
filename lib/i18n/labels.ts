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
