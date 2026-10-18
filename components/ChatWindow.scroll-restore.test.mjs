import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("ChatWindow.tsx", await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);
const restore = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
  && node.arguments[0].getText(source).includes("restoreStartedRef.current = true"));
assert.ok(restore, "阅读位置恢复流程必须存在");
const script = new Script(ts.transpileModule(`(${restore.arguments[0].getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);

function setup() {
  const loads = [];
  const cleared = [];
  const context = createContext({
    pendingScrollRestore: { atBottom: false, anchorEntryId: "anchor", anchorOffset: -10, oldestEntryId: "oldest" },
    session: { id: "session" }, loading: false, searchTarget: null,
    restoreStartedRef: { current: false }, loadingOlderRef: { current: false },
    searchHistoryRef: { current: { entryIds: [], historyCursor: "cursor", hasEarlierMessages: true } },
    AbortController, VISIBLE_PAGE_SIZE: 50,
    loadOlderPage: (...args) => new Promise(resolve => loads.push({ args, resolve })),
    setVisibleCount() {}, setRestoreAnchorReady() {}, scrollToBottom() {},
    setPendingScrollRestore: value => cleared.push(value),
  });
  return { context, loads, cleared, start: () => script.runInContext(context)() };
}

test("后台依赖刷新可重启恢复流程，不能清除尚未恢复的阅读位置", () => {
  const state = setup();
  const stop = state.start();
  assert.equal(state.loads.length, 1);
  stop();
  assert.equal(state.loads[0].args[2].signal.aborted, true);
  assert.deepEqual(state.cleared, []);
  const stopNext = state.start();
  assert.equal(state.loads.length, 2);
  stopNext();
});

test("旧请求取消后迟到，不能解除新恢复流程的分页互斥", async () => {
  const state = setup();
  const stop = state.start();
  stop();
  const stopNext = state.start();
  state.loads[0].resolve(undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.context.loadingOlderRef.current, true);
  assert.deepEqual(state.cleared, []);
  stopNext();
  state.loads[1]?.resolve(undefined);
});

test("只有未锁定的主动分支切换取消恢复，同一叶节点和后台通知保持目标", () => {
  const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === "handleBranchDataChange");
  assert.ok(declaration);
  const forward = new Script(ts.transpileModule(`(${declaration.initializer.arguments[0].getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
  const cleared = [];
  const navigated = [];
  let select;
  const context = createContext({
    setPendingScrollRestore: value => cleared.push(value),
    onBranchDataChange: (_tree, _leaf, callback) => { select = callback; },
  });
  const notify = forward.runInContext(context);
  const navigate = leaf => navigated.push(leaf);
  notify([], "current", navigate, false);
  assert.deepEqual(cleared, []);
  select("current");
  assert.deepEqual(cleared, []);
  notify([], "current", navigate, true);
  select("another");
  assert.deepEqual(cleared, []);
  notify([], "current", navigate, false);
  select("another");
  assert.deepEqual(cleared, [null]);
  assert.deepEqual(navigated, ["current", "another", "another"]);
});
