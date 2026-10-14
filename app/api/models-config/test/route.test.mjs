import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("model tests detect unsupported developer roles and accept the system-role override", async (t) => {
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = await mkdtemp(join(tmpdir(), "pi-imagin-role-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  });

  const payloads = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    payloads.push(payload);
    if (payload.messages.some(({ role }) => role === "developer")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unsupported developer role" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of [
      { choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 } },
    ]) {
      res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", model: "reasoning-model", ...chunk })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));

  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    moduleCache: false,
  });
  const { POST } = await jiti.import("./route.ts");
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  async function probe(compat) {
    const response = await POST(new Request("http://localhost/api/models-config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({
        providerName: "role-test",
        provider: { baseUrl, api: "openai-completions", apiKey: "local-test-key" },
        model: { id: "reasoning-model", reasoning: true, compat },
      }),
    }));
    assert.equal(response.status, 200);
    return response.json();
  }

  const rejected = await probe(undefined);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Unsupported developer role/);
  assert.equal(payloads[0].messages[0].role, "developer");

  const accepted = await probe({ supportsDeveloperRole: false });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.responseText, "OK");
  assert.equal(payloads[1].messages[0].role, "system");
  assert.equal(payloads[1].messages[1].role, "user");
  assert.equal(payloads.length, 2);
});
