"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");

function openInBrowser(url, platform = process.platform) {
  // 不启用 shell: true，避免 Node 的 DEP0190 警告；
  // Shell 参数未充分转义时
  // 可能被解释为命令并产生注入风险。
  // 传入结构化参数数组，让 Node 处理转义，
  // 不要把参数拼成 Shell 命令字符串。
  let opener;
  if (platform === "win32") {
    // start 是 cmd.exe 内置命令，需要直接调用 cmd，
    // 并在目标 URL 前提供必需的空标题参数。
    opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
      stdio: "ignore",
      detached: true,
    });
  } else {
    opener = spawn(platform === "darwin" ? "open" : "xdg-open", [url], {
      stdio: "ignore",
      detached: true,
    });
  }

  opener.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });

  opener.unref();
}

module.exports = { openInBrowser };
