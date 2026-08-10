import { describe, expect, it } from "vitest";
import type { Conversation } from "../types";
import { autoTitle, togglePinned, upsertConversation } from "./conversations";

function conversation(id: string, updatedAt: number, pinned?: boolean): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    ...(pinned === undefined ? {} : { pinned }),
    createdAt: updatedAt,
    updatedAt,
    messages: [{ role: "user", content: "hello" }],
  };
}

describe("upsertConversation", () => {
  it("sorts by recency (most recently updated first)", () => {
    const list = upsertConversation(
      [conversation("a", 1000), conversation("b", 2000)],
      conversation("c", 3000),
    );
    expect(list.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("replaces an existing conversation with the same id instead of duplicating", () => {
    const list = upsertConversation([conversation("a", 1000)], conversation("a", 5000));
    expect(list).toHaveLength(1);
    expect(list[0].updatedAt).toBe(5000);
  });

  it("floats pinned conversations above newer unpinned ones", () => {
    const list = upsertConversation(
      [conversation("old", 1000, true), conversation("new", 5000)],
      conversation("fresh", 6000),
    );
    expect(list[0].id).toBe("old");
    expect(list[1].id).toBe("fresh");
    expect(list[2].id).toBe("new");
  });
});

describe("togglePinned", () => {
  it("flips the pinned flag", () => {
    const list = togglePinned([conversation("a", 1000)], "a");
    expect(list[0].pinned).toBe(true);
    const back = togglePinned(list, "a");
    expect(back[0].pinned).toBe(false);
  });

  it("floats the pinned conversation to the top immediately", () => {
    const list = togglePinned(
      [conversation("a", 1000), conversation("b", 2000)],
      "b",
    );
    expect(list[0].id).toBe("b");
    expect(list[0].pinned).toBe(true);
    // The unpinned chat keeps no flag and drops below the pinned one.
    expect(list[1].id).toBe("a");
    expect(list[1].pinned).toBeUndefined();
  });
});

describe("autoTitle", () => {
  it("uses the first user message and collapses whitespace", () => {
    expect(autoTitle([{ role: "user", content: "  explain   this  code " }])).toBe(
      "explain this code",
    );
  });

  it("truncates long titles to 42 characters", () => {
    const long = "a".repeat(60);
    expect(autoTitle([{ role: "user", content: long }])).toHaveLength(43); // 42 + ellipsis
  });

  it("returns an empty string when there is no user message", () => {
    expect(autoTitle([{ role: "assistant", content: "hi" }])).toBe("");
  });
});
