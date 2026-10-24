// Staff texts of S01 / S02 that have no 04 id (image-only labels, taken as spec text; staff screens are ja only).
export const W3 = {
  // S01
  ledger: "予約台帳", today: "今日", prev: "前日", next: "翌日", date: "日付", doctorPrefix: "医師:", all: "全員", statePrefix: "状態:",
  searchPh: "予約番号で検索", newBooking: "新規予約", candidateLink: "未確定の候補（7日以上）{m}件を表示",
  adjustHeading: "要調整の予約 {n}件（全日付）", footer: "（行は時刻→医師の順）", batch: "夜間締め", menu: "操作",
  colTime: "時刻", colNo: "予約番号", colName: "患者氏名・フリガナ", colVisit: "診療区分", colDoctor: "医師", colVisitDoctor: "区分・医師",
  colState: "状態", colQ: "問診", colNotes: "備考", colCheckin: "受付", colMenu: "操作",
  q: "問診あり", notes: "備考", checkin: "受付", undo: "受付取消", change: "変更", cancel: "取消", noShow: "無断キャンセル確定",
  correct: "来院に訂正", adjust: "調整依頼を送信", adjustBulk: "調整依頼を送信（一括）", adjusted: "調整依頼済 {at}",
  unrequested: "(指名なし)", close: "閉じる", cancelBtn: "キャンセル", doCancel: "取り消す",
  cancelTitle: "予約を取り消す — {no} {name} 様 {start}〜", reason: "取消理由", reasonText: "その他の内容", reasonPh: "その他の場合は内容（200文字まで）",
  channel: "連絡経路", phone: "電話", counter: "窓口", dlgCancelTitle: "予約を取り消しますか？", dlgNoShowTitle: "無断キャンセルとして確定しますか？",
  dlgAdjustTitle: "調整依頼を送信しますか？", answerLang: "回答言語: {lang}", notesPrefix: "備考:", qTitle: "問診 — {name} 様（{type}・{dept}）",
  notesTitle: "備考 — {name} 様", noRows: "この日の予約はありません。",
  reasons: { RECOVERED: "体調回復", SCHEDULE: "患者都合", RESCHEDULE: "日程変更", CLINIC: "医院都合", OTHER: "その他" },
  states: {
    RESERVED: "予約済", CHECKED_IN: "来院済", NO_SHOW: "無断キャンセル", CANCELED: "キャンセル済", ADJUST: "要調整", CANDIDATE: "無断キャンセル候補",
  },
  candidateOld: "候補（7日以上未確定）", channels: { WEB: "Web", PHONE: "電話", COUNTER: "窓口" },
  batchStatus: { SUCCESS: "正常終了", PARTIAL: "一部エラー", FAILED: "失敗", RUNNING: "実行中" },
  field: { date: "日付", bookingNo: "予約番号", reason: "取消理由", reasonText: "その他の内容", channel: "連絡経路" },
  // S02
  proxy: "代理予約", badgeNew: "新規", badgeChange: "変更", areaPatient: "患者", areaCond: "予約条件", areaFrame: "枠の選択", areaInfo: "予約情報",
  tabSearch: "既存患者を検索", tabNew: "新しい患者を登録", kana: "フリガナ", tel: "電話番号", card: "診察券番号", bno: "予約番号", search: "検索する",
  condition: "検索条件", colPName: "氏名", colBirth: "生年月日", colTel: "電話番号", colCard: "診察券", web: "Web会員", count: "{n}件",
  changeLink: "変更", dept: "診療科", visit: "診療区分", pick: "選択してください", noPref: "指名なし",
  visitNote: "診療区分はスタッフ専用（Web非公開）を含む全区分。予約可能期間・休診日は適用、当日の締切なし（開始済みの枠も選択可）。",
  frameDate: "予約日", selected: "選択", free: "○", full: "×", legend: "○ 空き  × 満  斜線 休診・シフト外  ■ 選択中",
  target: "通知先", chRoute: "受付経路", memo: "備考", optional: "任意", back: "台帳に戻る", backNote: "（保存せずに戻る・確認なし）",
  confirm: "予約を確定する", confirmChange: "変更を確定する", changeTarget: "変更対象: {no} {date} {start}〜{end}",
  nameType: "氏名の種類", nameJp: "日本語氏名", nameRomaji: "ローマ字氏名", name: "姓 / 名", family: "姓", given: "名", kanaPair: "フリガナ（セイ / メイ）",
  kanaFamily: "セイ", kanaGiven: "メイ", birth: "生年月日", sex: "性別", male: "男性", female: "女性", address: "郵便番号・住所", postcode: "郵便番号",
  prefecture: "都道府県", city: "市区町村", town: "町域", line: "番地", building: "建物名", buildingPh: "建物名（任意）", townOther: "その他（直接入力）",
  sms: "SMSでの予約通知に同意を得た（口頭）", cardOpt: "任意・本院", viewSearch: "患者を検索", dlg020Title: "同じ日に予約があります", dlg021Title: "通知先がありません",
  targets: { MAIL: "メール（Web会員）", SMS: "SMS", LINE: "LINE（Web会員）", NONE: "なし" },
  readback: "{name} 様・{date} {start}〜{end}・{dept} {visit}・{doctor}",
} as const;

export const w3 = (text: string, params: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (whole, k: string) => (k in params ? String(params[k]) : whole));
