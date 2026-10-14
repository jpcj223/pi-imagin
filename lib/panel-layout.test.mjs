import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clampPanelWidth,
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
} = await jiti.import("./panel-layout.ts");

test("clamps panel widths to finite bounds", () => {
  assert.equal(clampPanelWidth(420.4, 180, 480), 420);
  assert.equal(clampPanelWidth(120, 180, 480), 180);
  assert.equal(clampPanelWidth(600, 180, 480), 480);
  assert.equal(clampPanelWidth(Number.NaN, 180, 480), 180);
  assert.equal(clampPanelWidth(200, 300, 250), 300);
});

test("keeps the responsive right panel default within useful limits", () => {
  assert.equal(getDefaultRightPanelWidth(700), 280);
  assert.equal(getDefaultRightPanelWidth(1366), 450);
  assert.equal(getDefaultRightPanelWidth(1920), 673);
});

test("reserves chat space while split panels are visible", () => {
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 700,
    rightPanelOpen: true,
    rightPanelWidth: 560,
  }), 332);
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 1366,
    rightPanelOpen: true,
    rightPanelWidth: 686,
  }), 212);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1024,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 296);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1366,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 638);
});

test("does not rewrite desktop widths while the file panel is in overlay mode", () => {
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 850,
    sidebarOpen: true,
    sidebarWidth: 480,
  }), 1200);
});
