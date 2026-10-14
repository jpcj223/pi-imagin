// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFileSync } = require("node:fs");

const messagePath = process.argv[2];
if (!messagePath) {
  console.error("提交校验失败：缺少提交信息文件。");
  process.exit(1);
}

const title = readFileSync(messagePath, "utf8")
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/, 1)[0];
const format = /^(feat|fix|refactor|perf|docs|style|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: ([^\s].*)$/;
const match = title.match(format);
const errors = [];

if (!match || title !== title.trimEnd()) {
  errors.push("标题应为 类型(范围): 中文说明，例如 feat(chat): 完成会话界面改造。");
}
if (!match || !/\p{Script=Han}/u.test(match[2])) {
  errors.push("提交说明必须包含中文。");
}
if (Array.from(title).length > 72) {
  errors.push("提交标题不能超过 72 个字符。");
}
if (errors.length > 0) {
  console.error("提交校验失败：\n" + errors.join("\n"));
  process.exit(1);
}
