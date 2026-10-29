import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("./registry.ts");

/** 语言包之间键一致还不够：界面误写一个不存在的键，也会原样显示在页面上。 */
test("界面引用的固定翻译键在三种语言中均存在", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const missing = [];
  const locales = getSupportedLocales().map(locale => getLocalePlugin(locale));
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text;
          for (const locale of locales) {
            if (!Object.hasOwn(locale.messages, key)) missing.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${locale.id} ${key}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  for (const directory of ["components", "hooks", "app"]) await walk(`${root}/${directory}`);
  assert.deepEqual(missing, []);
});
