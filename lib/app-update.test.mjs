import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getPiImaginReleaseUrl, isNewerStableVersion } = await jiti.import("./app-update.ts");

test("detects newer stable Pi Imagin versions", () => {
  assert.equal(isNewerStableVersion("0.8.8", "0.8.7"), true);
  assert.equal(isNewerStableVersion("0.9.0", "0.8.7"), true);
  assert.equal(isNewerStableVersion("1.0.0", "0.9.9"), true);
});

test("does not report equal, older, or unsupported versions as updates", () => {
  assert.equal(isNewerStableVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.8-beta.1", "0.8.7"), false);
  assert.equal(isNewerStableVersion("invalid", "0.8.7"), false);
});

test("builds a release-notes URL only for stable versions", () => {
  assert.equal(
    getPiImaginReleaseUrl("0.8.8", "https://github.com/test-owner/pi-imagin"),
    "https://github.com/test-owner/pi-imagin/releases/tag/v0.8.8",
  );
  assert.equal(getPiImaginReleaseUrl("0.8.8-beta.1"), null);
  assert.equal(getPiImaginReleaseUrl("0.8.8", ""), null);
});
