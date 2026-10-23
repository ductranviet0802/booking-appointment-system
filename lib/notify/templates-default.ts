// Default notification texts of 04 §6.2 (mail subject + body; LINE uses the mail body) and §6.3 (SMS).
// Loaded into notification_templates for every clinic by the seed; A04 edits them.
import type { Language, NotificationEvent, NotifyChannel } from "@prisma/client";

type Text = Record<Language, string>;

export const MAIL_DEFAULTS: Record<NotificationEvent, { subject: Text; body: Text }> = {
  NT01_BOOKED: {
    subject: {
      JA: "【{{clinic_name}}】ご予約を承りました（{{booking_no}}）",
      EN: "[{{clinic_name}}] Booking confirmed ({{booking_no}})",
      VI: "[{{clinic_name}}] Xác nhận lịch hẹn ({{booking_no}})",
    },
    body: {
      JA: "{{patient_name}}様 ご予約ありがとうございます。以下の内容で承りました。 予約番号: {{booking_no}} / 日時: {{visit_date}} {{visit_time}} / 診療科: {{department}} / 診療区分: {{visit_type}} / 担当医: {{doctor_name}} {{notice}} 変更・キャンセルは{{deadline}}まで、こちらから行えます: {{booking_url}} それ以降は{{clinic_phone}}までお電話ください。",
      EN: "Dear {{patient_name}}, thank you for your booking. Booking no.: {{booking_no}} / Date: {{visit_date}} {{visit_time}} / Department: {{department}} / Visit type: {{visit_type}} / Doctor: {{doctor_name}} {{notice}} You can change or cancel online until {{deadline}}: {{booking_url}} After that, please call {{clinic_phone}}.",
      VI: "Kính gửi {{patient_name}}, cảm ơn bạn đã đặt lịch. Mã lịch hẹn: {{booking_no}} / Thời gian: {{visit_date}} {{visit_time}} / Khoa: {{department}} / Loại khám: {{visit_type}} / Bác sĩ: {{doctor_name}} {{notice}} Bạn có thể thay đổi hoặc hủy trực tuyến đến {{deadline}}: {{booking_url}} Sau thời hạn này, vui lòng gọi {{clinic_phone}}.",
    },
  },
  NT02_REMIND: {
    subject: {
      JA: "【{{clinic_name}}】明日のご予約のお知らせ",
      EN: "[{{clinic_name}}] Reminder: your appointment tomorrow",
      VI: "[{{clinic_name}}] Nhắc lịch hẹn ngày mai",
    },
    body: {
      JA: "{{patient_name}}様 明日 {{visit_date}} {{visit_time}} にご予約をいただいております（予約番号 {{booking_no}}、{{department}}）。{{notice}} ご都合が悪くなった場合は{{deadline}}までに {{booking_url}} から変更・キャンセルしてください。",
      EN: "Dear {{patient_name}}, this is a reminder of your appointment tomorrow, {{visit_date}} {{visit_time}} (booking no. {{booking_no}}, {{department}}). {{notice}} If you cannot come, please change or cancel by {{deadline}}: {{booking_url}}",
      VI: "Kính gửi {{patient_name}}, bạn có lịch hẹn vào ngày mai, {{visit_date}} {{visit_time}} (mã {{booking_no}}, {{department}}). {{notice}} Nếu không thể đến, vui lòng thay đổi hoặc hủy trước {{deadline}}: {{booking_url}}",
    },
  },
  NT03_CHANGED: {
    subject: {
      JA: "【{{clinic_name}}】ご予約の変更を承りました（{{booking_no}}）",
      EN: "[{{clinic_name}}] Booking changed ({{booking_no}})",
      VI: "[{{clinic_name}}] Đã thay đổi lịch hẹn ({{booking_no}})",
    },
    body: {
      JA: "{{patient_name}}様 ご予約を以下の内容に変更しました。日時: {{visit_date}} {{visit_time}} / 担当医: {{doctor_name}} 詳細: {{booking_url}}",
      EN: "Dear {{patient_name}}, your booking has been changed to: {{visit_date}} {{visit_time}} / Doctor: {{doctor_name}}. Details: {{booking_url}}",
      VI: "Kính gửi {{patient_name}}, lịch hẹn của bạn đã được đổi sang: {{visit_date}} {{visit_time}} / Bác sĩ: {{doctor_name}}. Chi tiết: {{booking_url}}",
    },
  },
  NT04_CANCELED: {
    subject: {
      JA: "【{{clinic_name}}】ご予約のキャンセルを承りました（{{booking_no}}）",
      EN: "[{{clinic_name}}] Booking cancelled ({{booking_no}})",
      VI: "[{{clinic_name}}] Đã hủy lịch hẹn ({{booking_no}})",
    },
    body: {
      JA: "{{patient_name}}様 {{visit_date}} {{visit_time}} のご予約（予約番号 {{booking_no}}）をキャンセルしました。またのご利用をお待ちしております。",
      EN: "Dear {{patient_name}}, your booking on {{visit_date}} {{visit_time}} (no. {{booking_no}}) has been cancelled. We look forward to seeing you another time.",
      VI: "Kính gửi {{patient_name}}, lịch hẹn ngày {{visit_date}} {{visit_time}} (mã {{booking_no}}) đã được hủy. Rất mong được phục vụ bạn lần sau.",
    },
  },
  NT05_PW_RESET: {
    subject: { JA: "パスワード再設定のご案内", EN: "Reset your password", VI: "Hướng dẫn đặt lại mật khẩu" },
    body: {
      JA: "以下のリンクから{{valid_minutes}}分以内にパスワードを再設定してください: {{reset_url}} お心当たりのない場合は、このメールを破棄してください。",
      EN: "Please reset your password within {{valid_minutes}} minutes using this link: {{reset_url}} If you did not request this, please ignore this e-mail.",
      VI: "Vui lòng đặt lại mật khẩu trong vòng {{valid_minutes}} phút bằng liên kết sau: {{reset_url}} Nếu bạn không yêu cầu, vui lòng bỏ qua email này.",
    },
  },
  NT06_VERIFY: {
    subject: { JA: "メールアドレスのご確認", EN: "Please confirm your e-mail address", VI: "Xác nhận địa chỉ email" },
    body: {
      JA: "メールアドレスを確認するため、{{valid_hours}}時間以内に次のリンクを開いてください: {{verify_url}}",
      EN: "To confirm your e-mail address, please open this link within {{valid_hours}} hours: {{verify_url}}",
      VI: "Để xác nhận địa chỉ email của bạn, vui lòng mở liên kết sau trong vòng {{valid_hours}} giờ: {{verify_url}}",
    },
  },
  NT07_ADJUST: {
    subject: {
      JA: "【{{clinic_name}}】ご予約日時の調整のお願い",
      EN: "[{{clinic_name}}] Your booking needs to be rescheduled",
      VI: "[{{clinic_name}}] Cần sắp xếp lại lịch hẹn",
    },
    body: {
      JA: "{{patient_name}}様 誠に申し訳ございません。{{visit_date}} {{visit_time}} のご予約（予約番号 {{booking_no}}）は、当院の都合により診療ができなくなりました。お手数ですが {{booking_url}} から日時を変更いただくか、{{clinic_phone}}までご連絡ください。",
      EN: "Dear {{patient_name}}, we are very sorry: we can no longer see you at {{visit_date}} {{visit_time}} (booking no. {{booking_no}}) for reasons on our side. Please choose a new time at {{booking_url}} or call {{clinic_phone}}.",
      VI: "Kính gửi {{patient_name}}, chúng tôi rất xin lỗi: vì lý do từ phía phòng khám, chúng tôi không thể khám cho bạn vào {{visit_date}} {{visit_time}} (mã {{booking_no}}). Vui lòng chọn thời gian mới tại {{booking_url}} hoặc gọi {{clinic_phone}}.",
    },
  },
};

export const SMS_DEFAULTS: Partial<Record<NotificationEvent, Text>> = {
  NT01_BOOKED: {
    JA: "{{clinic_name}}: {{visit_date}} {{visit_time}}のご予約を承りました。{{booking_url}}",
    EN: "{{clinic_name}}: booked {{visit_date}} {{visit_time}}. {{booking_url}}",
    VI: "{{clinic_name}}: đã đặt lịch {{visit_date}} {{visit_time}}. {{booking_url}}",
  },
  NT02_REMIND: {
    JA: "{{clinic_name}}: 明日{{visit_time}}のご予約です。変更は{{booking_url}}",
    EN: "{{clinic_name}}: appointment tomorrow {{visit_time}}. {{booking_url}}",
    VI: "{{clinic_name}}: lịch hẹn ngày mai {{visit_time}}. {{booking_url}}",
  },
  NT03_CHANGED: {
    JA: "{{clinic_name}}: ご予約を{{visit_date}} {{visit_time}}に変更しました。{{booking_url}}",
    EN: "{{clinic_name}}: booking moved to {{visit_date}} {{visit_time}}. {{booking_url}}",
    VI: "{{clinic_name}}: đã đổi lịch sang {{visit_date}} {{visit_time}}. {{booking_url}}",
  },
  NT04_CANCELED: {
    JA: "{{clinic_name}}: {{visit_date}}のご予約をキャンセルしました。",
    EN: "{{clinic_name}}: booking on {{visit_date}} cancelled.",
    VI: "{{clinic_name}}: đã hủy lịch hẹn ngày {{visit_date}}.",
  },
  NT07_ADJUST: {
    JA: "{{clinic_name}}: {{visit_date}}のご予約の日時変更をお願いします。{{booking_url}}",
    EN: "{{clinic_name}}: please rebook your {{visit_date}} appointment. {{booking_url}}",
    VI: "{{clinic_name}}: vui lòng đổi lịch hẹn ngày {{visit_date}}. {{booking_url}}",
  },
};

/** Every default row of one clinic: MAIL for all 7 events, LINE (mail body, no subject) and SMS for the 5 booking events */
export function defaultTemplateRows(): Array<{ event: NotificationEvent; channel: NotifyChannel; language: Language; subject: string | null; body: string }> {
  const langs: Language[] = ["JA", "EN", "VI"];
  return (Object.keys(MAIL_DEFAULTS) as NotificationEvent[]).flatMap((event) =>
    langs.flatMap((language) => {
      const mail = MAIL_DEFAULTS[event];
      const sms = SMS_DEFAULTS[event];
      return [
        { event, channel: "MAIL" as const, language, subject: mail.subject[language], body: mail.body[language] },
        ...(sms
          ? [
              { event, channel: "LINE" as const, language, subject: null, body: mail.body[language] },
              { event, channel: "SMS" as const, language, subject: null, body: sms[language] },
            ]
          : []),
      ];
    }),
  );
}
