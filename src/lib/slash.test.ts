import { describe, expect, it } from "vitest";
import { buildSlashActions, getSlashQuery } from "./slash";
import type { Language } from "../types";

const lang: Language = "en";

describe("getSlashQuery", () => {
  it("returns the word after the leading slash, lowercased", () => {
    expect(getSlashQuery("/new")).toBe("new");
    expect(getSlashQuery("/THEME")).toBe("theme");
    expect(getSlashQuery("/capture text")).toBe("capture");
    expect(getSlashQuery("/new ")).toBe("new");
  });

  it("returns empty for prompts without a slash prefix", () => {
    expect(getSlashQuery("")).toBe("");
    expect(getSlashQuery("hello")).toBe("");
    expect(getSlashQuery("/")).toBe("");
  });
});

describe("buildSlashActions", () => {
  it("returns every action when the prompt is just a slash", () => {
    const actions = buildSlashActions("/", [], [], lang);
    expect(actions.length).toBeGreaterThan(0);
  });

  it("puts an exact keyword match first so /new + Enter runs New chat", () => {
    const actions = buildSlashActions("/new", [], [], lang);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].kind).toBe("system");
    expect(actions[0].systemId).toBe("new");
  });

  it("matches system keywords (theme, capture, incognito, settings, hide, clear)", () => {
    const cases: Array<[string, string]> = [
      ["/theme", "theme"],
      ["/capture", "capture"],
      ["/incognito", "incognito"],
      ["/settings", "settings"],
      ["/hide", "hide"],
      ["/clear", "clear"],
    ];
    for (const [prompt, id] of cases) {
      const actions = buildSlashActions(prompt, [], [], lang);
      expect(actions[0].systemId, prompt).toBe(id);
    }
  });

  it("matches chip keywords (explain, fix, refactor, summarize, translate, improve, comment)", () => {
    const cases: Array<[string, string]> = [
      ["/explain", "explain"],
      ["/fix", "fix"],
      ["/refactor", "refactor"],
      ["/summarize", "summarize"],
      ["/translate", "translate"],
      ["/improve", "improve"],
      ["/comment", "comment"],
    ];
    for (const [prompt, id] of cases) {
      const actions = buildSlashActions(prompt, [], [], lang);
      expect(actions[0].chipId, prompt).toBe(id);
    }
  });

  it("does not treat a longer word as an exact match (/newchat)", () => {
    // "New chat" does not contain "newchat" and no keyword is "newchat", so
    // the palette is empty rather than running "New chat".
    const actions = buildSlashActions("/newchat", [], [], lang);
    expect(actions).toEqual([]);
  });

  it("ignores trailing text after the keyword (/new x runs New chat)", () => {
    // getSlashQuery stops at whitespace, so "/new x" resolves the same as
    // "/new" — both the palette and the Enter handler must agree.
    const actions = buildSlashActions("/new x", [], [], lang);
    expect(actions[0].systemId).toBe("new");
    expect(getSlashQuery("/new x")).toBe("new");
  });

  it("still matches labels fuzzily for the palette", () => {
    // "Toggle theme" contains "theme", but the exact keyword wins the top spot.
    const actions = buildSlashActions("/theme", [], [], lang);
    expect(actions[0].systemId).toBe("theme");
    // A partial prefix still lists matches (e.g. "/cap" → Capture screen region).
    const partial = buildSlashActions("/cap", [], [], lang);
    expect(partial.some((a) => a.systemId === "capture")).toBe(true);
  });

  it("includes custom actions and templates with no keywords via fuzzy label match", () => {
    const custom = [
      {
        id: "c1",
        label: "My custom review",
        icon: "sparkles" as const,
        prompt: "Review this",
      },
    ];
    const template = [
      { id: "t1", label: "Weekly summary template", prompt: "Summarize" },
    ];
    const actions = buildSlashActions("/review", custom, [], lang);
    expect(actions.some((a) => a.kind === "custom")).toBe(true);

    const templateActions = buildSlashActions("/weekly", [], template, lang);
    expect(templateActions.some((a) => a.kind === "template")).toBe(true);
  });
});
