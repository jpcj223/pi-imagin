import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import ts from "typescript";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("文本加载完成后保持直接编辑，显式预览和差异状态仍可恢复", () => {
  const file=ts.createSourceFile("FileViewer.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const viewer=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="TextFileViewer");
  const effects=viewer.body.statements.filter(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(file)==="useEffect"&&n.expression.arguments[0].getText(file).includes("updateDisplayMode")).map(n=>n.getText(file)).join("\n");
  const {outputText}=ts.transpileModule(effects,{});
  const run=new Function("useEffect","data","displayMode","isDelimitedTable","defaultPreviewEligibleRef","HTML_PREVIEW_MAX_BYTES","gitDiffResolved","hasGitDiff","requestedInitialDisplayMode","autoDiffAppliedRef","updateDisplayMode",outputText);
  for(const language of ["markdown","html","text"]){
    for(const mode of ["source","preview","diff"]){
      let actual=mode;
      run(fn=>fn(),{language,truncated:false,size:50},mode,language==="text",{current:true},10*1024*1024,true,true,mode,{current:false},next=>{actual=next;});
      assert.equal(actual,mode,`${language} 的 ${mode} 不应被文件加载自动切换`);
    }
  }
});

test("lightweight source rows are skipped for highlighted, diff, and preview views", () => {
  // Execute the source-view calculations without mounting the file-fetching component.
  const file = ts.createSourceFile("FileViewer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const viewer = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const calculations = viewer.body.statements.filter((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
      ["isDelimitedTable", "viewerContent", "sourceLines", "language", "isHtml", "isMarkdown", "hasPreview", "effectiveDisplayMode", "useLightweightSource", "lightweightSourceLines"].includes(declaration.name.getText(file)),
    ),
  ).map((node) => node.getText(file)).join("\n");
  const { outputText } = ts.transpileModule(`
    return (data, displayMode, hasGitDiff = false, isDeletedDiff = false, wrapLines = false, filePath = "/tmp/file.txt") => {
      const isDelimitedTablePath = (path) => /\\.(csv|tsv)$/i.test(path);
      const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
      const HTML_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
      const FILE_LINE_NUMBER_STYLE = {};
      ${calculations}
      return lightweightSourceLines;
    };
  `, { compilerOptions: { jsx: ts.JsxEmit.React } });
  const render = new Function("React", "useMemo", outputText)(React, (calculate) => calculate());
  const large = { content: "line\n".repeat(1_000), language: "text" };

  assert.equal(render({ ...large, content: "line\n".repeat(999) }, "source"), null);
  assert.equal(render(large, "diff", true), null);
  assert.equal(render(large, "source", true, true), null);
  for (const language of ["html", "markdown"]) {
    assert.equal(render({ ...large, language }, "preview"), null);
  }
  // A CSV/TSV table previews a loaded prefix too; markdown waits for the whole file.
  assert.equal(render({ ...large, truncated: true }, "preview", false, false, false, "/tmp/data.csv"), null);
  assert.equal(render({ ...large, language: "markdown", truncated: true }, "preview").length, 1_001);
  // A partly loaded HTML file previews too: the preview fetches it whole.
  assert.equal(render({ ...large, language: "html", truncated: true, size: 900 * 1024 }, "preview"), null);
  for (const mode of ["source", "diff", "preview"]) {
    const rows = render(large, mode);
    assert.equal(rows.length, 1_001, `${mode} must retain its source fallback`);
    assert.equal(rows[0].props["data-line-number"], 1);
    assert.equal(rows[0].props.children[1].props.children, "line");
  }
  assert.equal(render(large, "source", false, false, true)[0].props.children[1].props.style.whiteSpace, "pre-wrap");
});

test("partly loaded HTML previews up to the HTML cap; partly loaded markdown does not", () => {
  const start = source.indexOf("  const hasPreview = ");
  // 源文件可使用 LF 或 CRLF，截取同一条声明，避免把后续逻辑一并执行。
  const statement = source.slice(start).match(/^\s*const hasPreview = [\s\S]*?;\r?\n/)?.[0];
  assert.ok(statement, "预览条件声明必须存在");
  const hasPreview = new Function("data", "isHtml", "isMarkdown", "isDelimitedTable", "HTML_PREVIEW_MAX_BYTES", `${statement}\nreturn hasPreview;`);
  const cap = 10 * 1024 * 1024;
  const partial = { truncated: true, size: 900 * 1024 };

  assert.equal(hasPreview(partial, true, false, false, cap), true);
  assert.equal(hasPreview({ ...partial, size: cap + 1 }, true, false, false, cap), false);
  assert.equal(hasPreview({ truncated: false, size: cap + 1 }, true, false, false, cap), true);
  assert.equal(hasPreview(partial, false, true, false, cap), false);
  assert.equal(hasPreview({ ...partial, size: cap + 1 }, false, false, true, cap), true);
});
