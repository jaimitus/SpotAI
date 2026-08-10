import { describe, expect, it } from "vitest";
import { formatCaptureTime, formatDuration } from "./format";
import type { Language } from "../types";

const LANGS: Language[] = ["en", "es", "de", "pt", "fr"];

describe("formatCaptureTime", () => {
  // Built with local-time components so the result is stable regardless of
  // the machine's timezone.
  const ts = new Date(2026, 0, 15, 14, 32, 5).getTime();

  it("formats as a 24h HH:MM:SS clock time in every supported language", () => {
    for (const lang of LANGS) {
      expect(formatCaptureTime(ts, lang)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    }
  });

  it("preserves the wall-clock time across all locales", () => {
    for (const lang of LANGS) {
      const [hours, minutes, seconds] = formatCaptureTime(ts, lang)
        .split(":")
        .map(Number);
      expect([hours, minutes, seconds]).toEqual([14, 32, 5]);
    }
  });

  it("falls back to the English locale for unknown languages", () => {
    const fallback = formatCaptureTime(ts, "it" as Language);
    expect(fallback).toBe(formatCaptureTime(ts, "en"));
  });
});

describe("formatDuration", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(7)).toBe("00:07");
    expect(formatDuration(73)).toBe("01:13");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("keeps minutes growing past an hour without special-casing hours", () => {
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(73.9)).toBe("01:13");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5)).toBe("00:00");
    expect(formatDuration(-0.1)).toBe("00:00");
  });
});
