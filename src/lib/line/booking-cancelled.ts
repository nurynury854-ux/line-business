import "server-only";

import { t } from "@/i18n";
import { formatDateLong, formatPriceTwd } from "@/i18n/format";
import { TAIPEI_TIME_ZONE, calendarDateInTaipei } from "@/lib/time/taipei";

/**
 * The card a customer receives after cancelling through the app.
 *
 * Deliberately a chat message and not only a screen: the screen closes, the
 * chat stays, and "did I actually cancel?" is the question this answers a day
 * later. Takes an INSTANT, converted to Asia/Taipei here at the display
 * boundary (CLAUDE.md §4).
 */

export type BookingCancelledInput = {
  tenantName: string;
  brandPrimary: string;
  serviceName: string;
  staffName: string;
  startsAt: Date;
  priceTwd: number;
  bookingId: string;
  /** LIFF URL of the booking page, for the "book again" button. Null omits it. */
  bookAgainUrl: string | null;
};

function taipeiTime(instant: Date): string {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

function row(label: string, value: string) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      { type: "text", text: label, size: "sm", color: "#888888", flex: 3 },
      { type: "text", text: value, size: "sm", color: "#222222", flex: 7, wrap: true, weight: "bold" },
    ],
  };
}

export function buildBookingCancelledMessage(input: BookingCancelledInput) {
  const { tenantName, brandPrimary, serviceName, staffName, startsAt, priceTwd, bookingId, bookAgainUrl } = input;

  const date = calendarDateInTaipei(startsAt);
  const dateLabel = formatDateLong(date);
  const time = taipeiTime(startsAt);
  const shortReference = bookingId.slice(0, 8).toUpperCase();

  const footer: Record<string, unknown>[] = [];
  if (bookAgainUrl) {
    footer.push({
      type: "button",
      style: "primary",
      color: brandPrimary,
      height: "sm",
      action: { type: "uri", label: t("notify.action.bookAgain"), uri: bookAgainUrl },
    });
  }
  footer.push({
    type: "text",
    text: t("notify.confirm.reference", { reference: shortReference }),
    size: "xxs",
    color: "#aaaaaa",
    align: "center",
    margin: "md",
  });

  return {
    type: "flex",
    altText: t("notify.cancelled.altText", { date: dateLabel, time, service: serviceName }),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        // Neutral header: a cancellation is not the salon's brand moment.
        backgroundColor: "#555555",
        paddingAll: "16px",
        contents: [
          { type: "text", text: tenantName, color: "#ffffffcc", size: "sm" },
          { type: "text", text: t("notify.cancelled.title"), color: "#ffffff", size: "xl", weight: "bold", margin: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [
          { type: "text", text: t("notify.cancelled.lead"), size: "sm", color: "#555555", wrap: true },
          row(t("notify.confirm.service"), serviceName),
          row(t("notify.confirm.staff"), staffName),
          row(t("notify.confirm.date"), dateLabel),
          row(t("notify.confirm.time"), time),
          row(t("notify.confirm.price"), formatPriceTwd(priceTwd)),
          { type: "separator", margin: "lg" },
          { type: "text", text: t("notify.cancelled.rebook"), size: "xs", color: "#888888", wrap: true, margin: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: footer,
      },
    },
  };
}
