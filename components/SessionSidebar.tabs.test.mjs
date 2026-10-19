import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// 首次渲染固定使用会话视图，文件树在访问验证完成后才加载。
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider: LocaleProvider } = await jiti.import("@/hooks/useI18n");
// 英文断言显式设置应用语言；与组件使用相同导入路径，确保共享同一上下文。
const I18nProvider = (props) => React.createElement(LocaleProvider, { initialLocale: "en", ...props });
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");

const h = React.createElement;
const noop = () => {};

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SessionSidebar, {
    selectedSessionId: null,
    onSelectSession: noop,
    ...props,
  })));
}

test("the application stays Chinese by default and allows an explicit English fixture", () => {
  const chinese = renderToStaticMarkup(h(LocaleProvider, null, h(SessionSidebar, { selectedSessionId: null, onSelectSession: noop })));
  assert.match(chinese, /aria-label="侧边栏视图"/);
  assert.match(render(), /aria-label="Sidebar view"/);
});

test("the tabs layout keeps the brand, two tabs and no stacked files section header", () => {
  const html = render({ selectedCwd: "/work/alpha", onOpenTerminal: noop });
  assert.match(html, /^<div class="session-sidebar" style="--sidebar-files-height:320px"><div class="sidebar-header">[\s\S]*?<div class="sidebar-tabs-list" role="tablist" aria-label="Sidebar view">/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /sidebar-files-section|sidebar-files-keys|sidebar-files-changes|is-files-below/);
  // Both panels are tab panels; the files' is hidden behind its tab.
  assert.match(html, /<div id="session-sidebar-panel-files" role="tabpanel" aria-labelledby="session-sidebar-tab-files" hidden="" class="sidebar-panel sidebar-files-panel">/);
  // 项目选择器保持挂载；验证前不显示文件操作。
  assert.match(html, /<div class="sidebar-files-head"><div class="project-picker is-stacked is-project-browser" role="group"/);
  // No file search key: the toolbar row's search is the tab's.
  assert.doesNotMatch(html, /aria-controls="file-search-input"/);
});

test("file actions wait for validated workspace access", () => {
  for (const props of [{}, { selectedCwd: "/work/alpha" }, { selectedCwd: "/work/alpha", onOpenTerminal: noop }]) {
    const html = render(props);
    assert.doesNotMatch(html, /class="sidebar-files-actions"/);
    if (props.selectedCwd) assert.match(html, /class="project-picker-button is-project is-empty"/);
  }
});
