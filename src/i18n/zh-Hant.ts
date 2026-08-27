/**
 * zh-Hant-TW UI strings.
 *
 * Keys are semantic, never English-content-derived (CLAUDE.md §7). This is a
 * plain map rather than a library because the i18n library is still an open
 * decision — the shape is deliberately what next-intl or react-i18next would
 * consume, so swapping in a real library is mechanical.
 *
 * Tenant copy — salon name, service names, stylist names — is NOT here. That is
 * tenant data and lives in config/tenants (CLAUDE.md §5, §7).
 */
export const messages = {
  "booking.title": "線上預約",

  "booking.step.service": "選擇服務項目",
  "booking.step.staff": "選擇設計師",
  "booking.step.date": "選擇日期",
  "booking.step.time": "選擇時段",
  "booking.step.confirm": "確認預約內容",
  "booking.progress": "步驟 {current}／{total}",

  "booking.action.next": "下一步",
  "booking.action.back": "上一步",
  "booking.action.confirm": "送出預約",
  "booking.action.restart": "重新預約",

  "booking.service.duration": "{minutes} 分鐘",

  "booking.staff.any": "不指定設計師",
  "booking.staff.anyHint": "由沙龍安排當日可服務的設計師",

  "booking.date.today": "今天",
  "booking.date.closed": "公休",

  "booking.time.closedNotice": "本日公休，請選擇其他日期。",
  "booking.time.emptyNotice": "本日沒有可預約的時段，請選擇其他日期。",
  "booking.time.legend": "灰色時段代表已額滿或已超過預約時間。",
  "booking.time.forService": "{service}・{minutes} 分鐘",

  "booking.summary.service": "服務項目",
  "booking.summary.staff": "設計師",
  "booking.summary.date": "日期",
  "booking.summary.time": "時段",
  "booking.summary.duration": "所需時間",
  "booking.summary.price": "金額",

  "booking.done.title": "預約已送出",
  "booking.done.notice": "這是前端示意畫面，預約內容尚未寫入資料庫。",

  "booking.loading": "載入中…",

  "weekday.0": "週日",
  "weekday.1": "週一",
  "weekday.2": "週二",
  "weekday.3": "週三",
  "weekday.4": "週四",
  "weekday.5": "週五",
  "weekday.6": "週六",
} as const;

export type MessageKey = keyof typeof messages;
