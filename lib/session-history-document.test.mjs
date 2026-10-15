import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { sessionHistoryDocument } = await createJiti(import.meta.url).import("./session-history-document.ts");

test("适配历史样式时完整保留记录、过滤器及 SDK 脚本", () => {
  const body = '<body><input id="tree-search"><script id="session-data" type="application/json">{"text":"<tag>","entries":[1,2]}</script><script>function search(){return 1}</script></body>';
  const original = `<!doctype html><html><head><style>body{color:red}</style></head>${body}</html>`;
  for (const dark of [false, true]) {
    const adapted = sessionHistoryDocument(original, dark);
    assert.ok(adapted.includes(body.replace("</body>", "")));
    assert.ok(adapted.endsWith("</body></html>"));
    assert.ok(adapted.includes(`color-scheme:${dark ? "dark" : "light"}`));
    assert.ok(adapted.includes('id="workspace-history-style"'));
    assert.ok(adapted.includes("height:clamp(150px,30vh,230px)"));
  }
});
test("无完整文档时显示错误而不渲染响应内容", () => {
  assert.throws(() => sessionHistoryDocument('{"error":"not found"}', false), /格式不完整/);
});
test("隔离视图复制链接仍指向原导出地址，地址不能注入 HTML", () => {
  const adapted = sessionHistoryDocument('<head></head><body></body>', false, 'http://127.0.0.1/api/sessions/id/export?inline=1&name="<test>');
  assert.ok(adapted.includes('name="pi-share-base-url"'));
  assert.ok(adapted.includes('inline=1&amp;name=&quot;&lt;test&gt;'));
});
