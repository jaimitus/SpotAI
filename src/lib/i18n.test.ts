import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { t, translations } from "./i18n";
import { APP_VERSION } from "./version";

// Derived from the single source of truth so a version bump cannot break tests.
const configVersion = (
  JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf-8"),
  ) as { version?: string }
).version;

const languages = ["en", "es", "de", "pt", "fr"] as const;

type EnKey = keyof typeof translations.en;

// contextKind_empty is intentionally an empty string in every language.
const enKeys = (Object.keys(translations.en) as EnKey[]).filter(
  (key): boolean => key !== "contextKind_empty",
);

function keysOf(lang: (typeof languages)[number]): EnKey[] {
  return (Object.keys(translations[lang]) as EnKey[]).filter(
    (key): boolean => key !== "contextKind_empty",
  );
}

describe("i18n", () => {
  it("defines every English key in all three languages with no extras", () => {
    for (const lang of languages) {
      const keys = keysOf(lang);
      const missing = enKeys.filter((key) => !keys.includes(key));
      const extra = keys.filter((key) => !enKeys.includes(key));
      expect(missing, `${lang} is missing keys: ${missing.join(", ")}`).toEqual([]);
      expect(extra, `${lang} has unknown keys: ${extra.join(", ")}`).toEqual([]);
    }
  });

  it("has no empty values in the non-English dictionaries", () => {
    for (const lang of ["es", "de", "pt", "fr"] as const) {
      const empty = enKeys.filter(
        (key) => !translations[lang][key] || translations[lang][key].trim() === "",
      );
      expect(empty, `${lang} has empty values for: ${empty.join(", ")}`).toEqual([]);
    }
  });

  it("falls back to English for unknown languages", () => {
    expect(t("xx" as never, "appTitle")).toBe("SpotAI");
  });

  it("returns the key itself when no dictionary defines it", () => {
    expect(t("en", "missing-key" as never)).toBe("missing-key");
    expect(t("es", "missing-key" as never)).toBe("missing-key");
  });
});

describe("version", () => {
  it("is injected from the Tauri config (single source of truth)", () => {
    expect(APP_VERSION).toBe(configVersion);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
