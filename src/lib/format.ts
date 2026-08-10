import type { Language } from "../types";

/** Maps the app languages to the closest locale for time formatting. */
function localeFor(lang: Language): string {
  switch (lang) {
    case "es":
      return "es-ES";
    case "de":
      return "de-DE";
    case "pt":
      return "pt-PT";
    case "fr":
      return "fr-FR";
    default:
      return "en-GB";
  }
}

/**
 * Formats a capture timestamp as a localized clock time (e.g. "14:32:05").
 * Uses the local timezone of the machine, matching the capture's origin.
 */
export function formatCaptureTime(timestamp: number, lang: Language): string {
  return new Date(timestamp).toLocaleTimeString(localeFor(lang), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Formats a duration in seconds as mm:ss (e.g. 73 → "01:13"). Fractional
 * seconds are floored and negative values clamp to zero.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
