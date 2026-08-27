import { type MessageKey, messages } from "./zh-Hant";

export type { MessageKey };

/**
 * Looks up a message and fills named placeholders.
 *
 * Named interpolation rather than concatenation, deliberately: Chinese word
 * order does not track English, so fragments must never be glued together
 * (CLAUDE.md §7).
 */
export function t(
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const template: string = messages[key];
  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
