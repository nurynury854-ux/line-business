import {
  TAIPEI_TIME_ZONE,
  type CalendarDate,
  taipeiWallClockToInstant,
  weekdayOf,
} from "@/lib/time/taipei";
import { t } from "./index";

const LOCALE = "zh-Hant-TW";

/**
 * A calendar date is not an instant, so it is anchored at Taipei midday before
 * formatting. Midday keeps the value clear of both day boundaries, so no
 * formatter can round it into the neighbouring date (CLAUDE.md §4).
 */
function anchor(date: CalendarDate): Date {
  return taipeiWallClockToInstant(date, "12:00");
}

/** "8/28" — compact enough for a date tile. */
export function formatDayShort(date: CalendarDate): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TAIPEI_TIME_ZONE,
    month: "numeric",
    day: "numeric",
  }).format(anchor(date));
}

/** "週五" */
export function formatWeekday(date: CalendarDate): string {
  const weekday = weekdayOf(date);
  return t(`weekday.${weekday}` as const);
}

/** "2026年8月28日（週五）" */
export function formatDateLong(date: CalendarDate): string {
  const formatted = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(anchor(date));

  return `${formatted}（${formatWeekday(date)}）`;
}

/** "NT$800" — currency through the locale layer, never hand-built. */
export function formatPriceTwd(amount: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * "2 小時" or "90 分鐘" — a cutoff or lead time, in whichever unit reads
 * naturally. Whole hours are shown as hours; anything else stays in minutes so
 * "1.5 小時" never appears.
 */
export function formatMinutesAsDuration(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) {
    return t("duration.hours", { hours: minutes / 60 });
  }
  return t("duration.minutes", { minutes });
}

/** "9月3日（週三）14:00" — an instant, rendered in Asia/Taipei. */
export function formatInstantShort(instant: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TAIPEI_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}
