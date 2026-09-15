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

  "booking.liff.preparing": "正在連線 LINE…",
  "booking.liff.redirecting": "前往 LINE 登入…",
  "booking.liff.needLogin": "送出預約時需要登入 LINE。",
  "booking.liff.unavailable": "無法連線 LINE，請重新整理後再試。",

  "booking.slots.loading": "查詢可預約時段…",
  "booking.slots.error": "無法取得時段，請重新整理。",
  "booking.slots.retry": "重新查詢",

  "booking.submit.inProgress": "預約送出中…",
  "booking.error.conflict": "這個時段剛被其他客人預約了，已為您更新時段，請重新選擇。",
  "booking.error.notBookable": "這個時段目前無法預約，請選擇其他時段。",
  "booking.error.network": "連線失敗，請確認網路後再試一次。",
  "booking.error.generic": "預約失敗，請稍後再試。",
  "booking.error.needLogin": "請先登入 LINE 再送出預約。",

  "booking.done.reference": "預約編號",
  "booking.done.notified": "預約確認已傳送到您的 LINE。",
  "booking.done.notifyFailed": "預約已成立，但確認訊息傳送失敗。請將此畫面截圖留存。",
  "booking.done.notifySkipped": "預約已成立。",

  // Pushed to the customer's LINE chat after a successful booking.
  "notify.confirm.altText": "預約確認：{date} {time}・{service}",
  "notify.confirm.title": "預約成功",
  "notify.confirm.service": "服務項目",
  "notify.confirm.staff": "設計師",
  "notify.confirm.date": "日期",
  "notify.confirm.time": "時間",
  "notify.confirm.duration": "所需時間",
  "notify.confirm.price": "金額",
  "notify.confirm.reassigned": "您選擇不指定設計師，已為您安排當日可服務的設計師。",
  "notify.confirm.changeNotice": "如需更改或取消預約，請直接與店家聯繫。",
  "notify.confirm.reference": "預約編號 {reference}",
  "booking.done.reassigned": "原設計師已額滿，已為您安排其他可服務的設計師。",

  // Salon-owner view.
  "admin.title": "預約管理",
  "admin.range.today": "今天",
  "admin.range.week": "未來七天",
  "admin.loading": "載入預約中…",
  "admin.error": "無法載入預約，請重新整理。",
  "admin.retry": "重新載入",
  "admin.empty.today": "今天目前沒有預約。",
  "admin.empty.week": "未來七天目前沒有預約。",
  "admin.notAdmin": "此 LINE 帳號沒有本店的管理權限。",
  "admin.needLogin": "請先登入 LINE。",
  "admin.count": "共 {count} 筆預約",
  "admin.revenue": "預估營收 {amount}",
  "admin.customerUnknown": "未提供姓名",
  "admin.customer": "客人",

  "weekday.0": "週日",
  "weekday.1": "週一",
  "weekday.2": "週二",
  "weekday.3": "週三",
  "weekday.4": "週四",
  "weekday.5": "週五",
  "weekday.6": "週六",
} as const;

export type MessageKey = keyof typeof messages;
