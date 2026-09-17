/**
 * DalaTech's own offerings — what the AGENCY sells to salons.
 *
 * Not to be confused with config/tenants/*, which is a salon's services sold to
 * its own customers. These are different businesses at different levels: a salon
 * charges for a haircut, DalaTech charges the salon for the system that books it.
 *
 * This is the file to edit. The page reads it and nothing else, so copy and
 * pricing change here without touching a component.
 *
 * PRICING IS NOT SET YET. Every offering below shows "洽詢報價" rather than a
 * number, which is a normal and professional state for custom work — not a
 * placeholder that looks unfinished. When a price is decided, replace
 * priceLabel with it.
 */

export type Offering = {
  id: string;
  /** Shown as the plan name. */
  name: string;
  /** One line under the name. What this is, in a prospect's words. */
  tagline: string;
  /** What the salon actually gets. Keep concrete and short. */
  includes: string[];
  /** A price, or an invitation to ask for one. */
  priceLabel: string;
  /** Optional note under the price, e.g. billing period or setup fee. */
  priceNote?: string;
  /** Draws the eye to one plan. At most one should be true. */
  highlighted?: boolean;
};

export type AgencyProfile = {
  name: string;
  tagline: string;
  /** Where the 立即諮詢 button sends someone. */
  contactUrl: string;
  offerings: Offering[];
  /** Answers to what prospects ask before buying. Optional. */
  faq: { question: string; answer: string }[];
};

export const dalaTech: AgencyProfile = {
  name: "DalaTech",
  tagline: "讓客人在 LINE 上完成預約，不必再用訊息來回確認。",

  // TODO: point at whatever you want prospects to do — a LINE chat, a form, a
  // phone number (tel:) or an email (mailto:).
  contactUrl: "https://line.me/R/ti/p/@633jpqcp",

  offerings: [
    {
      id: "booking-template",
      name: "預約系統模板",
      tagline: "現成的 LINE 預約系統，依貴店資料設定後即可使用。",
      includes: [
        "客人在 LINE 內完成預約，不需下載其他 App",
        "服務項目、設計師、營業時間依貴店設定",
        "預約成功自動傳送確認訊息",
        "前一天晚上自動提醒，降低爽約",
        "店家可查看今日與未來七天的預約",
      ],
      priceLabel: "洽詢報價",
      priceNote: "含初次設定與上線協助",
      highlighted: true,
    },
    {
      id: "custom-liff",
      name: "客製化 LIFF 開發",
      tagline: "模板之外的需求，依貴店流程量身開發。",
      includes: [
        "會員集點、儲值或優惠券",
        "多分店與跨店預約",
        "與現有系統或報表串接",
        "指定設計師排班與休假管理",
      ],
      priceLabel: "洽詢報價",
      priceNote: "依需求範圍評估",
    },
    {
      id: "oa-setup",
      name: "LINE 官方帳號設定",
      tagline: "從零開始建立官方帳號與圖文選單。",
      includes: [
        "官方帳號與 Provider 申請設定",
        "圖文選單設計與設定",
        "加入好友歡迎訊息與自動回覆",
        "後續操作教學",
      ],
      priceLabel: "洽詢報價",
    },
  ],

  // TODO: replace with what salons actually ask you. These are the questions a
  // salon owner would reasonably have, not claims about your business.
  faq: [
    {
      question: "客人需要另外下載 App 嗎？",
      answer: "不需要。整個預約流程都在 LINE 裡完成，客人只要加入貴店的官方帳號即可。",
    },
    {
      question: "我們原本的官方帳號可以繼續用嗎？",
      answer: "可以。系統會建立在貴店名下的官方帳號，原有的好友與訊息紀錄都會保留。",
    },
    {
      question: "需要多久才能上線？",
      answer: "視貴店服務項目與設定複雜度而定，詳細時程於洽詢時說明。",
    },
  ],
};
