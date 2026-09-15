import "server-only";

import { t } from "@/i18n";
import { formatDateLong, formatPriceTwd } from "@/i18n/format";
import { TAIPEI_TIME_ZONE, calendarDateInTaipei } from "@/lib/time/taipei";

/**
 * The day-before reminder card.
 *
 * Takes an INSTANT rather than wall-clock strings, because the reminder job
 * reads timestamptz straight from the database. Conversion to Asia/Taipei
 * happens here, at the display boundary, and nowhere upstream (CLAUDE.md §4).
 */

export type BookingReminderInput = {
  tenantName: string;
  brandPrimary: string;
  serviceName: string;
  staffName: string;
  startsAt: Date;
  durationMinutes: number;
  priceTwd: number;
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

export function buildBookingReminderMessage(input: BookingReminderInput) {
  const { tenantName, brandPrimary, serviceName, staffName, startsAt, durationMinutes, priceTwd } = input;

  const date = calendarDateInTaipei(startsAt);
  const time = taipeiTime(startsAt);

  return {
    type: "flex",
    altText: t("notify.reminder.altText", { time, service: serviceName }),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: brandPrimary,
        paddingAll: "16px",
        contents: [
          { type: "text", text: tenantName, color: "#ffffffcc", size: "sm" },
          { type: "text", text: t("notify.reminder.title"), color: "#ffffff", size: "xl", weight: "bold", margin: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [
          { type: "text", text: t("notify.reminder.lead"), size: "sm", color: "#555555", wrap: true },
          { type: "separator", margin: "md" },
          row(t("notify.confirm.date"), formatDateLong(date)),
          row(t("notify.confirm.time"), time),
          row(t("notify.confirm.service"), serviceName),
          row(t("notify.confirm.staff"), staffName),
          row(t("notify.confirm.duration"), t("booking.service.duration", { minutes: durationMinutes })),
          row(t("notify.confirm.price"), formatPriceTwd(priceTwd)),
          {
            type: "text",
            text: t("notify.reminder.changeNotice"),
            size: "xs",
            color: "#888888",
            wrap: true,
            margin: "lg",
          },
        ],
      },
    },
  };
}
