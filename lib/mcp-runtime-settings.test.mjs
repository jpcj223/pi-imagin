import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { writeMcpRuntimeEnabled } = await jiti.import("./mcp-runtime-settings.ts");
const { readBuiltinExtensionSwitches } = await jiti.import("./builtin-extensions.ts");

test("MCP 总开关保留其他扩展、通配规则和项目覆盖，默认开启", async t => {
  const root = await mkdtemp(join(tmpdir(), "mcp-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  await mkdir(agentDir); await mkdir(join(cwd, ".pi"), { recursive: true });
  const path = join(agentDir, "settings.json");
  const projectPath = join(cwd, ".pi/settings.json");
  assert.equal((await readBuiltinExtensionSwitches({ agentDir })).mcp.enabled, true);
  const initial = { extensions: ["!builtin:*", "+builtin:tool-search", "./custom.js", "-builtin:mcp"], keep: { untouched: 1 } };
  await writeFile(path, JSON.stringify(initial));
  await writeFile(projectPath, JSON.stringify({ extensions: ["-builtin:mcp"] }));
  await writeMcpRuntimeEnabled(true, path);
  let settings = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(settings, { ...initial, extensions: ["!builtin:*", "+builtin:tool-search", "./custom.js", "+builtin:mcp"] });
  let switches = await readBuiltinExtensionSwitches({ agentDir, cwd, projectTrusted: true });
  assert.equal(switches.mcp.global.enabled, true);
  assert.equal(switches.mcp.enabled, false);
  assert.equal(switches.codemode.enabled, false);
  assert.equal(switches["tool-search"].enabled, true);
  await writeMcpRuntimeEnabled(false, path);
  await writeMcpRuntimeEnabled(false, path);
  settings = JSON.parse(await readFile(path, "utf8"));
  assert.equal(settings.extensions.filter(entry => entry === "-builtin:mcp").length, 1);
  switches = await readBuiltinExtensionSwitches({ agentDir });
  assert.equal(switches.mcp.enabled, false);
  assert.equal(await readFile(projectPath, "utf8"), JSON.stringify({ extensions: ["-builtin:mcp"] }));
  for (const invalid of ['{"extensions":42}', '{"extensions":[false]}', '{ invalid']) {
    await writeFile(path, invalid);
    await assert.rejects(writeMcpRuntimeEnabled(true, path));
    assert.equal(await readFile(path, "utf8"), invalid);
  }
});
