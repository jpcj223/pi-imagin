import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { NewSessionProjectPicker } = await jiti.import("./NewSessionProjectPicker.tsx");
const managed = { id: "app", name: "正式项目", folders: [{ id: "root", name: "前端", path: "C:/app" }], defaultFolderId: "root", revision: 1 };
const context = { cwd: "C:/tests/gitee-ai", project: { key: "test", root: "C:/tests/gitee-ai" }, projects: [], managedProjects: [managed], worktrees: null, currentWorktreePath: null };
const render = (value, locale = "zh-CN") => renderToStaticMarkup(React.createElement(I18nProvider, { initialLocale: locale }, React.createElement(NewSessionProjectPicker, {
  context: value, mobile: false, handleRef: React.createRef(), onPick() {}, onClear() {}, onAdd() {},
})));

test("旧目录或已移除项目显示选择入口，不伪装成已关联项目", () => {
  for (const value of [context, { ...context, managedProjectId: "removed" }, { ...context, managedProjects: [] }]) {
    const html = render(value);
    assert.match(html, /project-picker-leaf">选择项目/);
    assert.doesNotMatch(html, /gitee-ai|project-picker-clear/);
  }
});

test("有效项目仍显示关联名和清除入口，不用目录叶名替代", () => {
  const html = render({ ...context, managedProjectId: managed.id });
  assert.match(html, /project-picker-leaf">正式项目/);
  assert.match(html, /project-picker-clear/);
  assert.doesNotMatch(html, /gitee-ai/);
});

test("三种语言使用对应选择提示，但不翻译用户命名的项目", () => {
  for (const [locale, prompt] of [["en", "Select project"], ["zh-CN", "选择项目"], ["zh-TW", "選擇專案"]]) {
    assert.ok(render(context, locale).includes(prompt));
    assert.ok(render({ ...context, managedProjectId: managed.id }, locale).includes("正式项目"));
  }
});
