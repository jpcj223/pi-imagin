import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider: LocaleProvider } = await jiti.import("@/hooks/useI18n");
// 英文断言显式设置应用语言；与组件使用相同导入路径，确保共享同一上下文。
const I18nProvider = (props) => React.createElement(LocaleProvider, { initialLocale: "en", ...props });
const { SessionSidebar, nearestEnabledKey, handOffDisabledKeyFocus, sameIdsOr } = await jiti.import("./SessionSidebar.tsx");
const { buildSessionTree, getRowOffsets, getVisibleRowIndices } = await jiti.import("@/lib/session-tree.ts");
const { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MIN_WIDTH } = await jiti.import("@/lib/panel-layout.ts");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sidebarStyles = await readFile(new URL("../app/sidebar.css", import.meta.url), "utf8");
const explorerSource = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

const h = React.createElement;
const noop = () => {};
const BASE = Date.parse("2026-10-01T00:00:00.000Z");

function between(startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(start, -1, `${startAnchor} not found`);
  assert.notEqual(end, -1, `${endAnchor} not found after ${startAnchor}`);
  return source.slice(start, end);
}

/** A sidebar callback's body: from its declaration to the next `const` of the component. */
function callbackBody(name) {
  return between(`const ${name} = `, "\n  const ");
}

function session(id, { project = "/work/alpha", modified = BASE, ...rest } = {}) {
  const time = new Date(modified).toISOString();
  return {
    path: `${project}/${id}.jsonl`,
    id,
    cwd: project,
    projectRoot: project,
    projectKey: project,
    created: time,
    modified: time,
    messageCount: 1,
    firstMessage: id,
    ...rest,
  };
}

function treeInput(overrides = {}) {
  return {
    sessions: [],
    uiState: { version: 1, revision: 0, sessions: {}, projects: {} },
    runningIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: null,
    currentProject: null,
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
    ...overrides,
  };
}

function render(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(SessionSidebar, {
    selectedSessionId: null,
    onSelectSession: noop,
    ...props,
  })));
}

/** The opening tag of the element with this id. */
function openingTag(html, id) {
  const match = html.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`));
  assert.ok(match, `#${id} not rendered`);
  return match[0];
}

test("scrolling keeps the focused session and the viewport mounted without expanding the whole tree", () => {
  const sessions = Array.from({ length: 2000 }, (_, index) => session(`s${index}`, { modified: BASE - index * 60_000 }));
  const { rows } = buildSessionTree(treeInput({ sessions, currentProject: { key: "/work/alpha", root: "/work/alpha" }, moreShown: { "/work/alpha": 5000 } }));
  const offsets = getRowOffsets(rows, "desktop");
  const lastSessionIndex = rows.findLastIndex((row) => row.kind === "session");
  for (const [scrollTop, focusedIndex] of [[0, lastSessionIndex], [30000, 1]]) {
    const indices = getVisibleRowIndices(offsets, scrollTop, 335, 240, [focusedIndex]);
    for (let index = 0; index < rows.length; index++) {
      const intersects = offsets[index + 1] > scrollTop && offsets[index] < scrollTop + 335;
      if (intersects) assert.ok(indices.includes(index), `row ${index} in the viewport is mounted`);
    }
    assert.ok(indices.includes(focusedIndex), "an inline rename survives scrolling");
    assert.ok(indices.length < 60, "only a window of the tree is mounted");
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
});

test("subagents fold into their main session row, which carries their running, unread and selected state", () => {
  const child = session("child", { relation: { kind: "subagent", parentSessionId: "main", profile: "explore", description: "", status: "running" } });
  const { rows } = buildSessionTree(treeInput({
    sessions: [session("main"), child],
    runningIds: new Set(["child"]),
    unreadIds: new Set(["child"]),
    selectedSessionId: "child",
    currentProject: { key: "/work/alpha", root: "/work/alpha" },
  }));
  const sessionRows = rows.filter((row) => row.kind === "session");
  assert.deepEqual(sessionRows.map((row) => row.family.root.id), ["main"]);
  assert.deepEqual(sessionRows[0].status, { running: true, awaiting: false, unread: true, selected: true, transient: false });
});

test("only Shift skips the session deletion confirmation", () => {
  assert.match(
    callbackBody("requestDelete"),
    /if \(shiftKey\) \{\s*void performDelete\(family\);\s*\} else \{[\s\S]*?setConfirmDeleteRootId\(family\.root\.id\);/,
  );
});

test("the initial sidebar exposes sessions and keeps the file panel mounted but hidden", () => {
  const html = render({ selectedCwd: "/work/alpha", onOpenTerminal: noop });
  assert.match(html, /^<div class="session-sidebar"/);
  assert.match(html, /class="sidebar-brand"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
  assert.doesNotMatch(openingTag(html, "session-sidebar-panel-sessions"), /hidden/);
  assert.match(openingTag(html, "session-sidebar-panel-files"), /role="tabpanel"[^>]*hidden=""/);
  assert.doesNotMatch(html, /data-resize-handle="sidebar-files"|is-files-below/);
});

test("the fold's and the archive view's motions in the CSS last as long as the hook's phase", async () => {
  const { SIDEBAR_MOTION_MS } = await jiti.import("@/hooks/useSidebarMotion.ts");
  // A phase ends on its element's own end event, else a little after
  // SIDEBAR_MOTION_MS (hooks/useSidebarMotion.ts): every motion it waits for
  // lasts that long.
  for (const [selector, property] of [
    [".session-sidebar.is-files-below.is-files-folding .sidebar-files-panel", "transition"],
    [".session-sidebar.is-files-below.is-files-folding .sidebar-toast-region", "transition"],
    [".sidebar-archive-view.is-entering", "animation"],
    [".sidebar-archive-view.is-leaving", "animation"],
  ]) {
    assert.match(sidebarRule(selector), new RegExp(`(?:^|\\s)${property}: [\\w-]+ ${SIDEBAR_MOTION_MS}ms `), selector);
  }
});

test("the first render has no in-flight fold or archive animation", () => {
  const html = render({ selectedCwd: "/work/alpha" });
  assert.doesNotMatch(html, / inert[ =>]|is-files-folding|sidebar-archive-view|is-entering|is-leaving/);
  assert.match(html, /<div class="sidebar-sessions-views"><div class="sidebar-sessions-view workspace-session-sections">/);
  assert.equal(openingTag(html, "session-sidebar-files-body"), '<div id="session-sidebar-files-body" class="sidebar-files-body">');
  assert.doesNotMatch(html, /role="separator"/);
});



/** A rule's declarations in app/sidebar.css (its first rule for the selector). */
function sidebarRule(selector) {
  const start = sidebarStyles.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} not found`);
  return sidebarStyles.slice(sidebarStyles.indexOf("{", start) + 1, sidebarStyles.indexOf("}", start));
}

function px(rule, property) {
  const match = rule.match(new RegExp(`(?:^|\\s)${property}: ([^;]+);`));
  assert.ok(match, `${property} not set`);
  return match[1].split(/\s+/).map((value) => Number.parseFloat(value));
}

/**
 * The files' right inset below the sessions (where the header row's keys and
 * the picker's boxes end) beside a session tree scrollbar this wide.
 */
function filesInsetRight(scrollbar) {
  const match = sidebarRule(".session-sidebar.is-files-below").match(/(?:^|\s)--sidebar-files-inset-right: max\((\d+)px, calc\(var\(--session-tree-scrollbar, 0px\) \+ (\d+)px\)\);/);
  assert.ok(match, "the files' right inset follows the session tree's scrollbar");
  return Math.max(Number(match[1]), scrollbar + Number(match[2]));
}

test("workspace validation gates file actions and retained split-layout CSS fits narrow sidebars", () => {
  const html = render({ selectedCwd: "/work/alpha", onOpenTerminal: noop });
  // 目录验证完成前不挂载文件操作，避免对过期或未授权路径执行操作。
  assert.doesNotMatch(html, /class="sidebar-files-actions"|class="sidebar-files-keys"/);
  assert.match(html, /class="project-picker-button is-project is-empty"/);
  // The keys share their group's width alike, 18 to 26px each. The group
  // never shrinks under its five keys' minimum nor grows past their
  // maximum, and its grow factor, far above the toggle's (1), gives it the
  // room the toggle's content leaves before the toggle takes any.
  const keyRule = sidebarRule(".sidebar-files-keys .sidebar-tool-button");
  assert.match(keyRule, /(?:^|\s)flex: 1 1 0;/);
  const [keyMin] = px(keyRule, "min-width");
  const [keyMax] = px(keyRule, "max-width");
  const keysGroup = sidebarRule(".sidebar-files-keys").match(/(?:^|\s)flex: (\d+) 0 calc\((\d+) \* (\d+)px\);[\s\S]*?max-width: calc\((\d+) \* (\d+)px\);/);
  assert.ok(keysGroup, "the keys' group: a grow factor, no shrink, its keys' minimum and maximum");
  const [, groupGrow, minCount, groupKeyMin, maxCount, groupKeyMax] = keysGroup.map(Number);
  assert.ok(groupGrow >= 1000, "the toggle gets a fraction of a pixel until the keys are at their widest");
  assert.deepEqual([minCount, groupKeyMin, maxCount, groupKeyMax], [5, keyMin, 5, keyMax]);
  assert.match(sidebarRule(".sidebar-files-section-toggle"), /(?:^|\s)flex: 1 1 auto;/);

  // The fit, added up from the CSS: the sidebar's width less its line, the
  // row's padding (on the right the files' inset beside the session tree's
  // classic scrollbar, Chromium's 10px) and the gap before the keys; the
  // toggle's content in Chromium's 11px system font (its 5px on either
  // side, the 12px chevron, a 3px gap, the label, then a 3px gap and the
  // count): "Files" 34px, "文件" 24px, "· 123" 26px, "· 2" 14px.
  const [scrollbar] = px(globalStyles.slice(globalStyles.indexOf("::-webkit-scrollbar {")), "width");
  const right = filesInsetRight(scrollbar);
  const [, , , left] = px(sidebarRule(".sidebar-files-section"), "padding");
  const [gap] = px(sidebarRule(".sidebar-files-section"), "gap");
  const [toggleMin] = px(sidebarRule(".sidebar-files-section-toggle"), "min-width");
  const [, toggleInset] = px(sidebarRule(".sidebar-files-section-toggle"), "padding");
  assert.equal(toggleMin, toggleInset + 12, "the toggle keeps its chevron");
  const content = (label, count = 0) => 2 * toggleInset + 12 + 3 + label + (count ? 3 + count : 0);
  const fit = (width, toggleContent) => {
    const room = width - 1 - left - right - gap;
    const key = Math.min(keyMax, Math.max(keyMin, (room - toggleContent) / 5));
    return { key, toggle: room - 5 * key };
  };
  // 默认宽度已收窄；旧分栏工具栏保证可操作的最小按钮和折叠入口即可。
  const filesCount = fit(SIDEBAR_DEFAULT_WIDTH, content(34, 26));
  assert.ok(filesCount.key >= keyMin && filesCount.toggle >= toggleMin);
  // From 300px they are at their widest, whatever the label and count.
  assert.equal(fit(300, content(34, 26)).key, keyMax);
  // At the sidebar's 180px minimum they are at their narrowest and nothing
  // overflows: the toggle keeps more than its chevron (what does not fit
  // in it wraps out of view, whole).
  const narrowest = fit(SIDEBAR_MIN_WIDTH, content(34, 26));
  assert.equal(narrowest.key, keyMin);
  assert.ok(narrowest.toggle >= toggleMin, `${toggleMin} + ${gap} + 5 × ${keyMin} fits ${SIDEBAR_MIN_WIDTH - 1 - left - right}`);
});

test("a key disabled under the focus hands it to the nearest key still enabled, the next one first", () => {
  const keys = ["terminal", "files", "changes", "search"].map((name) => ({ name, tagName: "BUTTON", disabled: false }));
  keys.forEach((key, index) => {
    key.previousElementSibling = keys[index - 1] ?? null;
    key.nextElementSibling = keys[index + 1] ?? null;
  });
  keys[2].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]).name, "search");
  keys[3].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]).name, "files", "the file search disabled too: the one before");
  keys[1].disabled = true;
  keys[0].disabled = true;
  assert.equal(nearestEnabledKey(keys[2]), null, "none left: the caller falls back to the toolbar row's search");
  // Only buttons count.
  keys[3].disabled = false;
  keys[3].tagName = "DIV";
  assert.equal(nearestEnabledKey(keys[2]), null);
});

test("a key just disabled hands its focus on while the focus is still on it, or fell to the page, and never takes the user's", () => {
  const focused = [];
  const key = (name) => ({ name, tagName: "BUTTON", disabled: false, focus: (options) => focused.push([name, options]) });
  const keys = ["ignored", "changes", "search"].map(key);
  keys.forEach((item, index) => {
    item.previousElementSibling = keys[index - 1] ?? null;
    item.nextElementSibling = keys[index + 1] ?? null;
  });
  const [, changes] = keys;
  const fallback = key("toolbar search");
  const body = { name: "body" };
  changes.disabled = true;

  // Current Chromium: the disabled key keeps the focus until the next
  // rendering update, after the layout effect. That counts as lost.
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0), [["search", { preventScroll: true }]]);
  // A browser that blurred it at once: the focus fell to the page (or nowhere).
  assert.equal(handOffDisabledKeyFocus({ activeElement: body, body }, changes, fallback), true);
  assert.equal(handOffDisabledKeyFocus({ activeElement: null, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0).map(([name]) => name), ["search", "search"]);
  // Focus the user put elsewhere stays.
  const elsewhere = { name: "a session row" };
  assert.equal(handOffDisabledKeyFocus({ activeElement: elsewhere, body }, changes, fallback), false);
  assert.deepEqual(focused, []);
  // No key left enabled: the fallback, still on the key or from the page.
  keys.forEach((item) => { item.disabled = true; });
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, fallback), true);
  assert.equal(handOffDisabledKeyFocus({ activeElement: body, body }, changes, fallback), true);
  assert.deepEqual(focused.splice(0).map(([name]) => name), ["toolbar search", "toolbar search"]);
  // Nothing to hand it to: nothing moves.
  assert.equal(handOffDisabledKeyFocus({ activeElement: changes, body }, changes, null), false);
  assert.deepEqual(focused, []);
});

test("below the sessions the picker is one row under the header row, lined up with it and with the session rows", () => {
  // The tree's first row 4px under the boxes: the head's 2px, none in the
  // scroll box, the tree's own 2px (FileExplorer's list).
  const belowHead = sidebarRule(".session-sidebar.is-files-below .sidebar-files-head");
  const [, , headBottom, headLeft] = px(belowHead, "padding");
  const [scrollTop] = px(sidebarRule(".session-sidebar.is-files-below .sidebar-files-scroll"), "padding-top");
  const treeTop = Number(explorerSource.match(/\(changesCollapsed \|\| gitFiles\.length === 0\) && \(!fileSearchOpen \|\| !hasSearchQuery\) && \(\s*<div style=\{\{ padding: "(\d+)px \d+px" \}\}>/)[1]);
  assert.equal(headBottom + scrollTop + treeTop, 4, "the tree's first row 4px under the boxes");
  // The paths start in the text column (the chevron column's 6px + 5px, the
  // 12px chevron, a 3px gap), after the box's 1px line and 10px padding.
  const [boxLine] = px(globalStyles.slice(globalStyles.indexOf("\n.project-picker-button {")), "border");
  const [, boxPadding] = px(globalStyles.slice(globalStyles.indexOf("\n.project-picker-button {")), "padding");
  const textColumn = 6 + 5 + 12 + 3;
  assert.equal(headLeft + boxLine + boxPadding, textColumn, "the paths in the text column");
  // The boxes end where the keys end and where a session row's time does,
  // whatever room the session tree's scrollbar takes (none for an overlay
  // one, 6px on a coarse pointer, 10px in Chromium, more elsewhere): a row
  // ends 6px in or on the scrollbar's gutter, its time 4px inside it.
  const treeInset = Number(sidebarStyles.match(/--session-tree-inset-right: max\(0px, calc\((\d+)px - var\(--session-tree-scrollbar, 0px\)\)\);/)[1]);
  const [, sessionRight] = px(sidebarRule(".session-tree-session"), "padding");
  for (const scrollbar of [0, 6, 10, 17]) {
    assert.equal(filesInsetRight(scrollbar), Math.max(treeInset, scrollbar) + sessionRight, `beside a ${scrollbar}px scrollbar`);
  }
});

test("the layout, the tab and the fold chosen last never change the first render, which matches the server's", () => {
  const serverHtml = render();
  const saved = {
    "pi-web:sidebar-files-placement": "tab",
    "pi-web:sidebar-tab": "files",
    "pi-web:sidebar-files-collapsed": "true",
    "pi-web:sidebar-groups-v2": JSON.stringify({ "/work/alpha": false }),
    "pi-web:sidebar-pins-collapsed": "true",
    "pi-web:sidebar-files-show-ignored": "true",
  };
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: (key) => saved[key] ?? null, setItem() {}, removeItem() {} },
  };
  let clientHtml;
  try {
    clientHtml = render();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
  // 恢复偏好前，客户端首次渲染必须与服务端一致，文件标签保持隐藏。
  assert.equal(clientHtml, serverHtml);
  assert.match(clientHtml, /^<div class="session-sidebar" style="--sidebar-files-height:320px">/);
  assert.match(openingTag(clientHtml, "session-sidebar-panel-files"), /hidden/);
  assert.equal(openingTag(clientHtml, "session-sidebar-files-body"), '<div id="session-sidebar-files-body" class="sidebar-files-body">');
  assert.match(clientHtml, /role="tablist"/);
});

test("the hidden file panel asks for a project before workspace restoration", () => {
  const html = render({ selectedCwd: "/work/alpha" });
  const filesPanel = html.slice(html.indexOf('id="session-sidebar-panel-files"'));
  // Before the sidebar has a cwd: the project box asks for one.
  assert.match(filesPanel, /<div class="project-picker is-stacked is-project-browser" role="group" aria-label="Project and worktree"><div class="project-picker-selection"><button type="button" class="project-picker-button is-project is-empty" title="" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(filesPanel, /<span class="project-picker-label">Select project…<\/span>/);
});

test("the running poll keeps the same Set while the running ids stay the same", () => {
  const previous = new Set(["a", "b"]);
  assert.equal(sameIdsOr(previous, ["b", "a"]), previous);
  assert.equal(sameIdsOr(previous, ["a", "b", "b"]), previous);
  assert.deepEqual([...sameIdsOr(previous, ["a"])], ["a"]);
  assert.deepEqual([...sameIdsOr(previous, ["a", "c"])], ["a", "c"]);
  const empty = new Set();
  assert.equal(sameIdsOr(empty, []), empty);
});
