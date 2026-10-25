import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { readMcpCatalogs, validMcpCatalog, DEFAULT_MCP_CATALOGS } = await createJiti(import.meta.url).import("./mcp-catalogs.ts");

test("网站偏好保留新增、编辑和空列表，损坏时回退默认入口", () => {
  assert.deepEqual(readMcpCatalogs(null), DEFAULT_MCP_CATALOGS);
  assert.deepEqual(readMcpCatalogs("broken"), DEFAULT_MCP_CATALOGS);
  assert.deepEqual(readMcpCatalogs("[]"), []);
  const value = [{ label: " 国内文档 ", href: " https://example.test/docs " }];
  assert.deepEqual(readMcpCatalogs(JSON.stringify(value)), [{ label: "国内文档", href: "https://example.test/docs" }]);
});

test("网站链接拒绝执行协议、登录凭据与无效输入", () => {
  for (const href of ["javascript:alert(1)", "file:///C:/config.json", "https://user:secret@example.test", "", "not a url"]) {
    assert.equal(validMcpCatalog({ label: "文档", href }), false);
    assert.deepEqual(readMcpCatalogs(JSON.stringify([{ label: "文档", href }])), DEFAULT_MCP_CATALOGS);
  }
  assert.equal(validMcpCatalog({ label: "", href: "https://example.test" }), false);
  assert.equal(validMcpCatalog({ label: "文档", href: "http://localhost:1234/docs" }), true);
});
