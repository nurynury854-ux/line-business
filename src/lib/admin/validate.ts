import "server-only";

import { LIMITS } from "./limits";

/**
 * Input parsing for the owner settings routes. Each helper returns the clean
 * value, or `undefined` for invalid input — never throws, never coerces a wrong
 * type into a plausible one.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function id(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

/** Trimmed, 1..max characters. */
export function requiredText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && [...trimmed].length <= max ? trimmed : undefined;
}

/** Trimmed, up to max characters; empty becomes null so the column clears. */
export function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return [...trimmed].length <= max ? trimmed : undefined;
}

export function integerIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

export function durationMinutes(value: unknown): number | undefined {
  const minutes = integerIn(value, LIMITS.minuteStep, LIMITS.maxDurationMinutes);
  return minutes !== undefined && minutes % LIMITS.minuteStep === 0 ? minutes : undefined;
}

/** An https URL or nothing. The database refuses anything else too (0008). */
export function httpsUrl(value: unknown): string | null | undefined {
  const text = optionalText(value, LIMITS.url);
  if (text === null || text === undefined) return text;
  try {
    return new URL(text).protocol === "https:" ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Digits and the separators a Taiwanese number is written with. */
export function phone(value: unknown): string | null | undefined {
  const text = optionalText(value, LIMITS.phone);
  if (text === null || text === undefined) return text;
  return /^[0-9+()\-# ]+$/.test(text) && /\d/.test(text) ? text : undefined;
}

/**
 * "HH:mm" on the 5-minute grid, 00:00..23:55. Asia/Taipei wall clock, stored
 * as-is in a `time` column — no conversion (CLAUDE.md §4).
 */
export function wallClock(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return undefined;
  return Number(match[2]) % LIMITS.minuteStep === 0 ? value : undefined;
}

/** "YYYY-MM-DD" that is a real date. */
export function calendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
    ? value
    : undefined;
}
