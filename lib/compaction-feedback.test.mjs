import assert from "node:assert/strict";
import test from "node:test";
import { getCompactionInfoKey } from "./compaction-feedback.ts";

test("only exact SDK no-op messages are informational", () => {
  assert.equal(getCompactionInfoKey("Nothing to compact (session too small)"), "chat.compactTooSmall");
  assert.equal(getCompactionInfoKey("Already compacted"), "chat.compactAlreadyDone");
  assert.equal(getCompactionInfoKey("Compaction failed: Nothing to compact (session too small)"), "chat.compactTooSmall");
  assert.equal(getCompactionInfoKey("Compaction failed: Already compacted"), "chat.compactAlreadyDone");
  for (const error of [undefined, null, "Network error", "API error (403)", "Compaction cancelled", "Request failed: Nothing to compact (session too small)", "Compaction failed: Network error"]) {
    assert.equal(getCompactionInfoKey(error), undefined);
  }
});
