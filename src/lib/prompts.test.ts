import { describe, expect, it } from "vitest";
import { ACTION_CHIPS, buildActionPrompt } from "./prompts";
import type { Language } from "../types";

describe("prompts", () => {
  it("provides a non-empty template for every chip in every language", () => {
    for (const chip of ACTION_CHIPS) {
      for (const lang of ["en", "es", "de"] as const) {
        const prompt = buildActionPrompt(chip.id, undefined, lang);
        expect(
          prompt.trim().length,
          `${chip.id} missing template in ${lang}`,
        ).toBeGreaterThan(10);
      }
    }
  });

  it("appends the user note after the base template", () => {
    const base = buildActionPrompt("explain", undefined, "en");
    const withNote = buildActionPrompt("explain", "Keep it short", "en");
    expect(withNote.startsWith(base)).toBe(true);
    expect(withNote).toContain("Keep it short");
  });

  it("ignores blank user notes", () => {
    const base = buildActionPrompt("fix", undefined, "en");
    expect(buildActionPrompt("fix", "   ", "en")).toBe(base);
  });

  it("falls back to English templates for unknown languages", () => {
    const fallback = buildActionPrompt("summarize", undefined, "fr" as Language);
    const english = buildActionPrompt("summarize", undefined, "en");
    expect(fallback).toBe(english);
  });
});
