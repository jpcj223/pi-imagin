import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { sidebarSectionLayout, loadSidebarSections, saveSidebarSections, SIDEBAR_SECTIONS_KEY } = await createJiti(import.meta.url).import("./sidebar-sections.ts");
const prefs = { defaultShare: 0.24, archiveShare: 0.24, archiveOpen: false };

test("空默认区不占高度，折叠归档只有入口，隐藏与恢复不改变偏好", () => {
  const onlyProject = sidebarSectionLayout(600, false, false, false, prefs);
  assert.equal(onlyProject.project, 600); assert.equal(onlyProject.default, 0); assert.equal(onlyProject.archive, 0);
  const folded = sidebarSectionLayout(600, true, true, false, prefs);
  assert.equal(folded.archive, 36);
  const open = sidebarSectionLayout(600, true, true, true, prefs);
  assert.ok(open.archive >= 96);
  assert.equal(open.project + open.default + open.archive + 16, 600);
  assert.deepEqual(sidebarSectionLayout(600, true, true, true, prefs), open);
  assert.deepEqual(prefs, { defaultShare: 0.24, archiveShare: 0.24, archiveOpen: false });
});

test("不同窗口高度与极端比例都不溢出，区域变大后恢复比例", () => {
  for (const height of [90, 160, 300, 600, 1200]) for (const hasDefault of [false, true]) for (const hasArchive of [false, true]) for (const archiveOpen of [false, true]) {
    const layout = sidebarSectionLayout(height, hasDefault, hasArchive, archiveOpen, { ...prefs, defaultShare: 0.9, archiveShare: 0.9 });
    for (const key of ["project", "default", "archive"]) assert.ok(layout[key] >= 0);
    assert.ok(layout.project + layout.default + layout.archive + 8 * (Number(hasDefault) + Number(hasArchive)) <= height + 0.001);
    assert.ok(layout.default <= layout.defaultMax + 0.001);
    assert.ok(layout.archive <= layout.archiveMax + 0.001);
  }
  const small = sidebarSectionLayout(600, true, true, true, prefs);
  const large = sidebarSectionLayout(1200, true, true, true, prefs);
  assert.ok(Math.abs(small.default / small.available - large.default / large.available) < 1e-12);
});

test("尺寸与归档开关分别保存，坏数据和存储失败安全回退", () => {
  const values = new Map(); const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveSidebarSections({ defaultShare: 0.4 }, store); saveSidebarSections({ archiveOpen: true }, store);
  assert.deepEqual(loadSidebarSections(store), { defaultShare: 0.4, archiveShare: 0.24, archiveOpen: true });
  values.set(SIDEBAR_SECTIONS_KEY, '{"defaultShare":-1,"archiveShare":"bad"}');
  assert.deepEqual(loadSidebarSections(store), prefs);
  values.set(SIDEBAR_SECTIONS_KEY, '{bad'); assert.deepEqual(loadSidebarSections(store), prefs);
  const unavailable = { getItem() { throw Error("disabled"); }, setItem() { throw Error("disabled"); } };
  assert.deepEqual(loadSidebarSections(unavailable), prefs);
  assert.doesNotThrow(() => saveSidebarSections({ archiveOpen: true }, unavailable));
});
