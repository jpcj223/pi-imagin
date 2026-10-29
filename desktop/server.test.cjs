/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { fork } = require("node:child_process");
const { once } = require("node:events");

test("后台启动器记录阶段并继续轮换预览密钥，健康通知不触发业务任务", async t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "pi-launcher-stages-"));
  fs.mkdirSync(path.join(root, ".next"));
  const manifest = path.join(root, ".next/prerender-manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ version: 4, preview: { previewModeId: "old-secret" } }));
  const entry = path.join(root, "server.cjs");
  fs.writeFileSync(entry, "process.on('message', m => { if(m.type==='fixture-stop') process.exit(0); }); process.send({type:'fixture-ready'});");
  const child = fork(path.join(__dirname, "server.cjs"), [entry], { env: { ...process.env, PI_IMAGIN_DESKTOP: "1", PI_WEB_PASSWORD: "not-for-logging" }, silent: true, windowsHide: true });
  const output = [];
  child.stdout.on("data", data => output.push(String(data)));
  child.stderr.on("data", data => output.push(String(data)));
  t.after(() => { if (child.exitCode === null) child.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  const [message] = await once(child, "message", { signal: AbortSignal.timeout(5000) });
  assert.equal(message.type, "fixture-ready");
  const exited = once(child, "exit");
  child.send({ type: "pi-imagin:backend-ready" });
  child.send({ type: "fixture-stop" });
  const [code] = await exited;
  assert.equal(code, 0);
  const log = output.join("");
  for (const stage of ["entry pid=", "preview secrets ready", "next entry loading", "next entry required"]) assert.ok(log.includes(stage), log);
  assert.ok(!log.includes("not-for-logging"));
  assert.notEqual(JSON.parse(fs.readFileSync(manifest)).preview.previewModeId, "old-secret");
});
