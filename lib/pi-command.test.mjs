import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("..", import.meta.url)) } });
const { writePiLaunchers, removePiLaunchers, USER_PATH_SCRIPT } = await jiti.import("./pi-command.ts");
const run = promisify(execFile);

test("命令入口正确传递参数和退出码，撤销不删除独立 Pi 命令", { skip: process.platform !== "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "pi command % ! & 测试-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = join(root, "fake-cli.cjs");
  await writeFile(cli, "console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;");
  writePiLaunchers(root, process.execPath, cli);
  await assert.rejects(run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${join(root, "pi.cmd")}" "argument with space" --version"`], { windowsVerbatimArguments: true }), error => {
    assert.equal(error.code, 7, error.stderr);
    assert.deepEqual(JSON.parse(error.stdout.trim()), ["argument with space", "--version"]);
    return true;
  });
  await writeFile(join(root, "pi"), "#!/bin/sh\necho user-owned\n");
  assert.throws(() => writePiLaunchers(root, process.execPath, cli), /unmanaged/);
  removePiLaunchers(root);
  assert.match(await readFile(join(root, "pi"), "utf8"), /user-owned/);
  await assert.rejects(readFile(join(root, "pi.cmd")), { code: "ENOENT" });
});

test("用户 PATH 注册保留其他项和变量类型，重复开启不累加，关闭只撤销自身项", { skip: process.platform !== "win32" }, async () => {
  // 用内存对象替代注册表，运行生产脚本的实际修改分支；不写真实用户环境。
  const script = USER_PATH_SCRIPT.split("Add-Type -Namespace")[0]
    .replace("$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')", "$key = $script:fakeKey")
    .replace(/\bexit\b/g, "return");
  const directory = "C:\\Users\\Test\\Pi Imagin\\command-bin";
  const original = "%USERPROFILE%\\bin;C:\\other-pi;C:\\custom";
  const cases = [
    { action: "enable", original, expected: `${original};${directory}` },
    { action: "enable", original: `${original};${directory}`, expected: `${original};${directory}` },
    { action: "disable", original: `${original};${directory.toUpperCase()}\\`, expected: original },
    { action: "disable", original, expected: original },
    { action: "enable", original: "", expected: directory },
  ];
  const setup = `
$script:fakeKey = [pscustomobject]@{}
$script:fakeKey | Add-Member ScriptMethod GetValue { $script:value }
$script:fakeKey | Add-Member ScriptMethod GetValueNames { @('Path') }
$script:fakeKey | Add-Member ScriptMethod GetValueKind { [Microsoft.Win32.RegistryValueKind]::ExpandString }
$script:fakeKey | Add-Member ScriptMethod SetValue { $script:value = $args[1]; if ($args[2] -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) { throw 'Wrong kind' } }
$script:fakeKey | Add-Member ScriptMethod Dispose {}
`;
  const commands = cases.map(value => `$script:value = '${value.original}'; $env:PI_IMAGIN_PATH_DATA = '${Buffer.from(JSON.stringify({ action: value.action, directory })).toString("base64")}'; & { ${script} } | Out-Null; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script:value))`).join("\n");
  const { stdout } = await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(setup + commands, "utf16le").toString("base64")], { windowsHide: true, timeout: 10000 });
  assert.deepEqual(stdout.trim().split(/\r?\n/).map(value => Buffer.from(value, "base64").toString()), cases.map(value => value.expected));
});

test("接口拒绝跨来源和非布尔开关，不执行环境注册", async () => {
  const { PUT } = await jiti.import("../app/api/pi-command/route.ts");
  const invalid = await PUT(new Request("http://localhost/api/pi-command", { method: "PUT", headers: { "Content-Type": "application/json", Host: "localhost", Origin: "http://localhost" }, body: '{"enabled":"true"}' }));
  assert.equal(invalid.status, 400);
  const crossOrigin = await PUT(new Request("http://localhost/api/pi-command", { method: "PUT", headers: { "Content-Type": "application/json", Host: "localhost", Origin: "https://example.com" }, body: '{"enabled":true}' }));
  assert.equal(crossOrigin.status, 403);
});
