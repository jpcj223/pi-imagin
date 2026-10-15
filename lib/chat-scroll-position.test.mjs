import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./chat-scroll-position.ts");
}

test("刷新定位仅接受有界条目和偏移，不恢复额外正文数据", async () => {
  const { restoreChatScrollPositions } = await loadSubject();
  assert.equal(restoreChatScrollPositions("invalid").size, 0);
  assert.equal(restoreChatScrollPositions(JSON.stringify(Array(21).fill(["a", { atBottom: true }]))).size, 0);
  const restored = restoreChatScrollPositions(JSON.stringify([
    ["a", { atBottom: true, text: "不应持久化" }],
    ["b", { atBottom: false, anchorEntryId: "entry", anchorOffset: -240, oldestEntryId: null }],
    ["c", { atBottom: false, anchorEntryId: "entry", anchorOffset: 1e20, oldestEntryId: null }],
  ]));
  assert.deepEqual([...restored], [["a", { atBottom: true }], ["b", { atBottom: false, anchorEntryId: "entry", anchorOffset: -240, oldestEntryId: null }]]);
});

test("anchors the most recent turn that started before the viewport", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  const anchor = findChatScrollAnchor([
    { entryId: "current-turn", top: 20, bottom: 80 },
    { entryId: "next-turn", top: 420, bottom: 480 },
  ], 200);

  assert.deepEqual(anchor, {
    anchorEntryId: "current-turn",
    anchorOffset: -180,
  });
});

test("falls back to the last message when the viewport is below all candidates", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  assert.deepEqual(findChatScrollAnchor([
    { entryId: "first", top: 0, bottom: 100 },
    { entryId: "last", top: 100, bottom: 200 },
  ], 250), {
    anchorEntryId: "last",
    anchorOffset: -150,
  });
});

test("uses the first turn when the viewport starts above it", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  assert.deepEqual(findChatScrollAnchor([
    { entryId: "first", top: 120, bottom: 180 },
    { entryId: "second", top: 240, bottom: 300 },
  ], 100), {
    anchorEntryId: "first",
    anchorOffset: 20,
  });
});

test("returns null when the conversation has no anchor candidates", async () => {
  const { findChatScrollAnchor } = await loadSubject();
  assert.equal(findChatScrollAnchor([], 100), null);
});
