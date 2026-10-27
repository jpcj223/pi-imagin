import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-imagin-deferred-"));
process.env.PI_CODING_AGENT_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));

const {
  findDeferredModel,
  rememberProviderModels,
  withDeferredProviderModels,
} = await createJiti(import.meta.url).import("./deferred-provider-models.ts");

const glm = { provider: "zai", id: "glm-4.7" };
const haiku = { provider: "claude-bridge", id: "claude-haiku-4-5" };
const opus = { provider: "claude-bridge", id: "claude-opus-5-5" };

/** `registered` is what the runtime knows; `available` the subset with working auth. */
function runtime(registered, available = registered) {
  return {
    getModels: () => registered,
    getAvailable: async (providerId) => available.filter((model) => !providerId || model.provider === providerId),
    getModel: (provider, id) => registered.find((model) => model.provider === provider && model.id === id),
    marker: "kept",
  };
}

beforeEach(() => {
  globalThis.__piImaginDeferredProviderCatalog = undefined;
  writeFileSync(join(root, "models.json"), JSON.stringify({ providers: {} }));
});

test("a runtime whose extension deferred its provider still lists the models seen earlier", async () => {
  // The first runtime of the process got the bridge's registration; later ones defer it to session_start.
  await rememberProviderModels(runtime([glm, haiku, opus]));
  const later = withDeferredProviderModels(runtime([glm]));
  assert.deepEqual(await later.getAvailable(), [glm, haiku, opus]);
  assert.deepEqual(await later.getAvailable("claude-bridge"), [haiku, opus]);
  assert.deepEqual(await later.getAvailable("zai"), [glm]);
  assert.equal(later.marker, "kept");
});

test("a provider the runtime registered but cannot use is not added back", async () => {
  await rememberProviderModels(runtime([glm, haiku]));
  // Signed out of claude-bridge: registered, not available. The picker must not offer it.
  const signedOut = withDeferredProviderModels(runtime([glm, haiku], [glm]));
  assert.deepEqual(await signedOut.getAvailable(), [glm]);
});

test("a deferred model is found only while this runtime lacks its provider", async () => {
  await rememberProviderModels(runtime([glm, haiku]));
  assert.deepEqual(findDeferredModel(runtime([glm]), "claude-bridge", "claude-haiku-4-5"), haiku);
  assert.equal(findDeferredModel(runtime([glm, haiku]), "claude-bridge", "claude-haiku-4-5"), undefined);
  assert.equal(findDeferredModel(runtime([glm]), "claude-bridge", "unknown"), undefined);
});


test("自定义服务商改名后不被延迟缓存补回，旧会话再次记录也不能复活旧名称", async () => {
  const old = { provider: "gitee", id: "fixture" };
  const current = { provider: "gitee-ai", id: "fixture" };
  writeFileSync(join(root, "models.json"), JSON.stringify({ providers: { gitee: { models: [{ id: "fixture" }] } } }));
  await rememberProviderModels(runtime([glm, haiku, old]));
  writeFileSync(join(root, "models.json"), JSON.stringify({ providers: { "gitee-ai": { models: [{ id: "fixture" }] } } }));
  await rememberProviderModels(runtime([glm, current]));
  await rememberProviderModels(runtime([old]));
  assert.deepEqual(await withDeferredProviderModels(runtime([glm, current])).getAvailable(), [glm, current, haiku]);
  assert.equal(findDeferredModel(runtime([glm, current]), "gitee", "fixture"), undefined);
});

test("删除自定义服务商后不补回，但真正延迟注册的扩展仍可用", async () => {
  writeFileSync(join(root, "models.json"), JSON.stringify({ providers: { zai: { models: [{ id: "glm-4.7" }] } } }));
  await rememberProviderModels(runtime([glm, haiku]));
  writeFileSync(join(root, "models.json"), JSON.stringify({ providers: {} }));
  assert.deepEqual(await withDeferredProviderModels(runtime([])).getAvailable(), [haiku]);
});
