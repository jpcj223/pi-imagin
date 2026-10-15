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
  assert.equal(getDefaultRightPanelWidth(700), 260);
  assert.equal(getDefaultRightPanelWidth(1366), 310);
  assert.equal(getDefaultRightPanelWidth(1920), 360);
  assert.equal(getDefaultRightPanelWidth(2560), 360);
});

test("reserves chat space while split panels are visible", () => {
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 700,
    rightPanelOpen: true,
    rightPanelWidth: 560,
  }), 340);
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 1366,
    rightPanelOpen: true,
    rightPanelWidth: 686,
  }), 220);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1024,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 260);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1366,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 362);
});

test("does not rewrite desktop widths while the file panel is in overlay mode", () => {
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 850,
    sidebarOpen: true,
    sidebarWidth: 480,
  }), 1200);
});

test("常用窗口尺寸为正文留出空间，旧的过宽面板也能收拢", () => {
  for (const viewportWidth of [880, 900, 1024, 1280, 1920, 2560]) {
    const maximum = getRightPanelMaxWidth({ viewportWidth, sidebarOpen: true, sidebarWidth: 220 });
    const restored = clampPanelWidth(680, 260, maximum);
    const chat = viewportWidth - 40 - 220 - restored;
    assert.ok(restored <= 480, `${viewportWidth}: 辅助区不应过宽`);
    assert.ok(chat >= (viewportWidth < 960 ? 320 : 420), `${viewportWidth}: 正文应保持可读宽度`);
    assert.ok(getDefaultRightPanelWidth(viewportWidth) <= 360);
  }
});
