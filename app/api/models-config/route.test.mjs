import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-imagin-models-config-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");
const modelsPath = join(testAgentDir, "models.json");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function put(body) {
  return new Request("http://localhost/api/models-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("a models.json with a syntax error is reported instead of read as empty, and a save cannot replace it", async () => {
  const original = '{ "providers": { "acme": { "models": [ } } }';
  await writeFile(modelsPath, original);

  let response = await GET();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /models\.json/);

  response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /models\.json/);
  assert.equal(await readFile(modelsPath, "utf8"), original);
});

test("a commented models.json loads with its providers", async () => {
  await writeFile(modelsPath, '{\n  // local models\n  "providers": { "acme": { "models": [{ "id": "a" },] } },\n}\n');

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: { acme: { models: [{ id: "a" }] } } });
});

test("model-level endpoints round-trip through Save, override only that model, and can return to inheritance", async () => {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const config = { providers: { relay: {
    baseUrl: "https://synthetic.invalid", api: "anthropic-messages", apiKey: "synthetic-not-a-key",
    models: [
      { id: "one", api: "openai-responses", baseUrl: "https://synthetic.invalid/v1", headers: { "x-example": "keep" } },
      { id: "two" },
    ],
  } } };
  const options = { authPath: join(testAgentDir, "auth.json"), modelsPath, modelsStorePath: join(testAgentDir, "models-store.json"), refreshOnCreate: false };
  assert.equal((await PUT(put(config))).status, 200);
  assert.deepEqual(await (await GET()).json(), config);
  const runtime = await ModelRuntime.create(options);
  assert.equal(runtime.getError(), undefined);
  assert.equal(runtime.getModel("relay", "one").baseUrl, "https://synthetic.invalid/v1");
  assert.equal(runtime.getModel("relay", "two").baseUrl, "https://synthetic.invalid");
  assert.equal(runtime.getModel("relay", "two").api, "anthropic-messages");
  delete config.providers.relay.models[0].baseUrl;
  assert.equal((await PUT(put(config))).status, 200);
  assert.deepEqual(await (await GET()).json(), config);
  const reset = await ModelRuntime.create(options);
  assert.equal(reset.getModel("relay", "one").baseUrl, "https://synthetic.invalid");
  assert.equal(reset.getModel("relay", "one").api, "openai-responses");
});

test("a symlinked models.json keeps its link: Save writes through it to its target", async t => {
  const targetPath = join(testAgentDir, "models-target.json");
  await writeFile(targetPath, JSON.stringify({ providers: { relay: { models: [{ id: "a" }] } } }));
  await rm(modelsPath, { force: true });
  try { await symlink(targetPath, modelsPath); }
  catch (error) { if (process.platform === "win32" && error.code === "EPERM") { t.skip("Windows 未授予文件符号链接权限"); return; } throw error; }

  const draft = { providers: { relay: { models: [{ id: "a" }, { id: "b" }] } } };
  assert.equal((await PUT(put(draft))).status, 200);
  assert.deepEqual(await (await GET()).json(), draft);
  assert.equal((await lstat(modelsPath)).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(await readFile(targetPath, "utf8")), draft);
});

test("a dangling models.json symbolic link is refused instead of replaced", async t => {
  await rm(modelsPath, { force: true });
  try { await symlink(join(testAgentDir, "models-gone.json"), modelsPath); }
  catch (error) { if (process.platform === "win32" && error.code === "EPERM") { t.skip("Windows 未授予文件符号链接权限"); return; } throw error; }

  const response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /dangling symbolic link/);
  assert.equal((await lstat(modelsPath)).isSymbolicLink(), true);
});
