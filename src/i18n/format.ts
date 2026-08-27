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
