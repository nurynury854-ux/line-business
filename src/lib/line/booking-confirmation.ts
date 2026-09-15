import "server-only";

import { t } from "@/i18n";
import { formatDateLong, formatPriceTwd } from "@/i18n/format";

/**
 * Builds the Flex Message a customer receives after booking.
 *
 * Everything tenant-visible comes in as data: the salon's name and brand colour
 * from its tenant row, service and stylist names from the catalogue. Labels go
 * through i18n keys (CLAUDE.md §5, §7).
 *
 * date and time are the Asia/Taipei WALL-CLOCK values the customer chose, passed
 * straight through from the validated request. No instant is converted here —
 * there is nothing to convert, which is the point (CLAUDE.md §4).
 */

export type BookingConfirmationInput = {
  tenantName: string;
  brandPrimary: string;
  serviceName: string;
  staffName: string;
  /** "YYYY-MM-DD", Asia/Taipei. */
  date: string;
  /** "HH:mm", Asia/Taipei. */
  time: string;
  durationMinutes: number;
  priceTwd: number;
  bookingId: string;
  /** True when "any stylist" was requested and the server chose one. */
  wasReassigned: boolean;
};

type FlexComponent = Record<string, unknown>;

function detailRow(label: string, value: string): FlexComponent {
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

export function buildBookingConfirmationMessage(input: BookingConfirmationInput) {
  const {
    tenantName, brandPrimary, serviceName, staffName, date, time,
    durationMinutes, priceTwd, bookingId, wasReassigned,
  } = input;

  const dateLabel = formatDateLong(date);
  // Short enough to read aloud to a receptionist, long enough to be unique in
  // any realistic day.
  const shortReference = bookingId.slice(0, 8).toUpperCase();

  const bodyRows: FlexComponent[] = [
    detailRow(t("notify.confirm.service"), serviceName),
    detailRow(t("notify.confirm.staff"), staffName),
    detailRow(t("notify.confirm.date"), dateLabel),
    detailRow(t("notify.confirm.time"), time),
    detailRow(t("notify.confirm.duration"), t("booking.service.duration", { minutes: durationMinutes })),
    detailRow(t("notify.confirm.price"), formatPriceTwd(priceTwd)),
  ];

  const notes: FlexComponent[] = [];
  if (wasReassigned) {
    notes.push({
      type: "text",
      text: t("notify.confirm.reassigned"),
      size: "xs",
      color: "#8a6d1f",
      wrap: true,
      margin: "md",
    });
  }
  notes.push({
    type: "text",
    text: t("notify.confirm.changeNotice"),
    size: "xs",
    color: "#888888",
    wrap: true,
    margin: "md",
  });

  return {
    type: "flex",
    altText: t("notify.confirm.altText", { date: dateLabel, time, service: serviceName }),
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
          { type: "text", text: t("notify.confirm.title"), color: "#ffffff", size: "xl", weight: "bold", margin: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [...bodyRows, { type: "separator", margin: "lg" }, ...notes],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          {
            type: "text",
            text: t("notify.confirm.reference", { reference: shortReference }),
            size: "xxs",
            color: "#aaaaaa",
            align: "center",
          },
        ],
      },
    },
  };
}
