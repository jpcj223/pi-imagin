"use strict";

// 运行记录位于 <agentDir>/pi-web-run/<启动器进程号>.json，
// 每个服务一份，由启动器在 Next 就绪后写入，退出时删除。
// 与其他状态一致，记录保存在 pi 的智能体目录中。

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileURLToPath } = require("url");

// 智能体目录优先取 PI_CODING_AGENT_DIR 并展开 ~，缺省为 ~/.pi/agent。
function getAgentDir(env = process.env, home = os.homedir()) {
  const configured = env.PI_CODING_AGENT_DIR;
  if (!configured) return path.join(home, ".pi", "agent");
  if (configured === "~") return home;
  if (configured.startsWith("~/") || configured.startsWith("~\\")) return path.join(home, configured.slice(2));
  if (configured.startsWith("file://")) return fileURLToPath(configured);
  return configured;
}

function getRunDir(env = process.env, home = os.homedir()) {
  return path.join(getAgentDir(env, home), "pi-web-run");
}

// 将本机浏览器可打开的地址作为入口：通配监听地址改为
// 回环地址，IPv6 地址补齐方括号。
function getOpenUrl(hostname, port) {
  let host = hostname;
  if (host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::" || host === "[::]") host = "::1";
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `http://${host}:${port}`;
}

function isProcessAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 表示进程存在，但当前用户无权操作。
    return error.code === "EPERM";
  }
}

// 查询当前进程命令行，Windows 使用映像名称；
// 进程不存在返回空字符串，无法判断返回 null。
function readProcessCommand(pid, { platform = process.platform, run = spawnSync, readFile = fs.readFileSync } = {}) {
  if (platform === "linux") {
    try {
      return readFile(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
    } catch (error) {
      return error.code === "ENOENT" ? "" : null;
    }
  }
  const result = platform === "win32"
    ? run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5_000 })
    : run("ps", ["-ww", "-p", String(pid), "-o", "args="], { encoding: "utf8", timeout: 5_000 });
  if (result.error) return null;
  const output = (result.stdout || "").trim();
  if (platform !== "win32") return output;
  // 匹配 tasklist 的 CSV 行；无匹配时会返回说明行。
  const match = /^"([^"]*)","(\d+)"/.exec(output);
  return match && match[2] === String(pid) ? match[1] : "";
}

// 验证进程仍属于记录中的启动器或 Next 服务。
// 崩溃或重启后进程号可能被其他进程复用，
// 停止操作绝不能向无关进程发送信号。Next 可能修改进程名；
// Windows 仅提供映像名称，无法确认时依赖服务 URL 检查。
function isRecordProcess(pid, role, { platform = process.platform, readCommand = readProcessCommand } = {}) {
  const command = readCommand(pid, { platform });
  if (command === null) return true;
  if (platform === "win32") return /^node/i.test(command);
  return role === "launcher"
    ? command.includes("pi-imagin") || command.includes("pi-web")
    : command.includes("next");
}

function recordPath(dir, pid) {
  return path.join(dir, `${pid}.json`);
}

function writeRunRecord(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = recordPath(dir, record.pid);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function removeRunRecord(dir, pid) {
  fs.rmSync(recordPath(dir, pid), { force: true });
}

// 任意 HTTP 响应都算服务可达，受密码保护的服务可能返回 401。
// 仅检查状态并立即丢弃响应体，释放连接，
// 避免 CLI 退出时留下尚未读取完的请求。
async function isServerAnswering(url, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
  } catch {
    return false;
  }
  await response.body?.cancel().catch(() => {});
  return true;
}

function isValidPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

// 按端口排序运行服务，stopPid 指向启动器，
// 或启动器已退出后继续运行的孤立 Next 进程。
// 没有属于本项目的进程或无法读取的记录会被删除；
// 进程仍存在但 URL 不响应时仅跳过，
// 不能因为暂时未就绪就删除记录。
async function listRunRecords(dir, {
  isAlive = isProcessAlive,
  isOurs = isRecordProcess,
  isAnswering = isServerAnswering,
} = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      record = null;
    }
    const launcherRuns = record && isValidPid(record.pid) && isAlive(record.pid) && isOurs(record.pid, "launcher");
    const nextRuns = !launcherRuns && record && isValidPid(record.nextPid) && isAlive(record.nextPid) && isOurs(record.nextPid, "next");
    if (launcherRuns || nextRuns) {
      candidates.push({ ...record, stopPid: launcherRuns ? record.pid : record.nextPid, orphaned: !launcherRuns });
    } else {
      fs.rmSync(file, { force: true });
    }
  }
  const answering = await Promise.all(candidates.map((record) => isAnswering(record.url)));
  return candidates.filter((_, index) => answering[index]).sort((a, b) => a.port - b.port);
}

// 停止和打开命令共用 --port 选择规则。
function selectRunRecord(records, port) {
  const matching = port === undefined ? records : records.filter((record) => String(record.port) === String(port));
  if (matching.length === 1) return { record: matching[0] };
  if (matching.length === 0) {
    return { error: port === undefined ? "No pi-imagin server is running." : `No pi-imagin server is running on port ${port}.` };
  }
  if (port !== undefined) {
    return { error: `Several pi-imagin servers are running on port ${port}:\n${matching.map(formatRunRecord).join("\n")}` };
  }
  return {
    error: `Several pi-imagin servers are running:\n${matching.map(formatRunRecord).join("\n")}\nPass --port <port> to choose one.`,
  };
}

function formatRunRecord(record) {
  const pid = record.orphaned ? `Next.js pid ${record.stopPid} (launcher gone)` : `pid ${record.pid}`;
  return `  ${record.url}  ${pid}  v${record.version}  started ${record.startedAt}`;
}

// 服务就绪时写入运行记录，启动器退出时删除。
// 写入失败只警告，服务可以继续运行。
// dir 可以是函数，其查找用户目录的错误也在此捕获。
function createRunRecordTracker({ dir, record, parentProcess = process, warn = console.warn }) {
  let written = false;
  return {
    markReady() {
      if (written) return;
      written = true;
      let runDir;
      try {
        runDir = typeof dir === "function" ? dir() : dir;
        writeRunRecord(runDir, record);
      } catch (error) {
        warn(`[pi-imagin] could not write the run record (pi-imagin status/stop/open will not see this server): ${error.message}`);
        return;
      }
      parentProcess.once("exit", () => removeRunRecord(runDir, record.pid));
    },
  };
}

module.exports = {
  createRunRecordTracker,
  formatRunRecord,
  getAgentDir,
  getOpenUrl,
  getRunDir,
  isProcessAlive,
  isRecordProcess,
  isServerAnswering,
  listRunRecords,
  readProcessCommand,
  removeRunRecord,
  selectRunRecord,
  writeRunRecord,
};
