import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  createSubagentExtension,
  preferPiImaginSubagentExtension,
  subagentFinalText,
  subagentNotificationText,
  SUBAGENT_NOTIFICATION_PREFIX,
  SUBAGENT_RESULT_PAGE_CHARS,
} = await createJiti(import.meta.url).import("./subagent-extension.ts");

async function loadTools(runtime, getProfiles = () => [], isEnabled = () => true) {
  const tools = new Map();
  const sent = [];
  const extension = createSubagentExtension(runtime, getProfiles, isEnabled);
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage(message, options) { sent.push({ message, options }); },
  });
  return { tools, sent };
}

function run(overrides = {}) {
  return {
    sessionId: "child-session",
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent-session",
    parentToolCallId: "tool-call",
    profile: "explore",
    description: "Find parser",
    task: "Find the parser",
    runInBackground: false,
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("long reports are paged without losing full output, error status or cleanup warnings", async () => {
  const original = "A".repeat(SUBAGENT_RESULT_PAGE_CHARS - 1) + "🐟" + "B".repeat(SUBAGENT_RESULT_PAGE_CHARS) + "FINAL_FINDING";
  const completed = run({ status: "completed", result: original, worktreeCleanupError: "KEEP_WORKTREE" });
  const { tools } = await loadTools({ async get() { return completed; }, markResultConsumed() {} });
  let offset = 0, restored = "", pages = 0;
  do {
    const reply = await tools.get("get_subagent_result").execute("read", { agent_id: completed.sessionId, offset });
    const text = reply.content[0].text;
    assert.match(text, /Worktree cleanup warning: KEEP_WORKTREE$/);
    assert.ok(text.length < SUBAGENT_RESULT_PAGE_CHARS + 700);
    const range = text.match(/Report excerpt (\d+)-(\d+) of (\d+) characters/);
    assert.ok(range);
    const body = text.split("characters; full report is retained in the subagent session.]\n\n")[1].split(/\n\n(?:To read the next excerpt|End of report\.)/)[0];
    assert.doesNotMatch(body, /[\uD800-\uDBFF]$/);
    assert.doesNotMatch(body, /^[\uDC00-\uDFFF]/);
    restored += body;
    offset = Number(range[2]); pages++;
  } while (offset < original.length);
  assert.equal(restored, original);
  assert.equal(completed.result, original);
  assert.equal(pages, 3);
  assert.match(subagentNotificationText(completed), /get_subagent_result.*offset=/);
  const failure = subagentFinalText({ ...completed, status: "failed", error: "TURN_LIMIT" });
  assert.match(failure, /failed: TURN_LIMIT/);
  assert.match(failure, /Partial output/);
  assert.ok(failure.length < SUBAGENT_RESULT_PAGE_CHARS + 700);
  assert.match(subagentFinalText(completed, original.length), /End of report/);
});

test("integrated extension exposes the legacy-compatible tool names", async () => {
  const tools = new Map();
  const extension = createSubagentExtension({
    async start(request) {
      const running = {
        sessionId: "child-session",
        sessionPath: "/tmp/child.jsonl",
        parentSessionId: "parent-session",
        parentToolCallId: request.parentToolCallId,
        profile: request.profile,
        description: request.description,
        task: request.task,
        runInBackground: true,
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      return {
        run: running,
        completion: Promise.resolve({
          ...running,
          status: "completed",
          completedAt: "2026-01-01T00:01:00.000Z",
          result: "Done",
        }),
      };
    },
    async get() { return null; },
    async steer() {},
    async notifyParent() {},
  }, () => []);
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
  });

  assert.deepEqual([...tools.keys()], ["Agent", "get_subagent_result", "steer_subagent"]);
  const result = await tools.get("Agent").execute(
    "tool-call",
    {
      subagent_type: "explore",
      prompt: "Find the parser",
      input_files: ["docs/parser.md"],
      description: "Find parser",
      run_in_background: true,
    },
    undefined,
    undefined,
    { sessionManager: { getSessionId: () => "parent-session" } },
  );
  assert.equal(result.details.kind, "pi-web-subagent");
  assert.equal(result.details.sessionId, "child-session");
});

test("control tools are model-only and activated on registration", async () => {
  const runtime = {
    async start() { throw new Error("unused"); },
    async get() { return null; },
    async steer() {},
    async notifyParent() {},
  };
  const { tools } = await loadTools(runtime);

  assert.deepEqual(
    [...tools.values()].map(({ name, exposure, defaultActive }) => ({ name, exposure, defaultActive })),
    [
      { name: "Agent", exposure: "model-only", defaultActive: undefined },
      { name: "get_subagent_result", exposure: "model-only", defaultActive: undefined },
      { name: "steer_subagent", exposure: "model-only", defaultActive: undefined },
    ],
  );
});

test("integrated extension registers no tools while its feature is disabled", async () => {
  let enabled = false;
  const runtime = {
    async start() { throw new Error("unused"); },
    async get() { return null; },
    async steer() {},
    async notifyParent() {},
  };
  const extension = createSubagentExtension(runtime, () => [], () => enabled);
  const disabledTools = new Map();
  await extension.factory({ registerTool(tool) { disabledTools.set(tool.name, tool); } });
  assert.deepEqual([...disabledTools], []);

  enabled = true;
  const enabledTools = new Map();
  await extension.factory({ registerTool(tool) { enabledTools.set(tool.name, tool); } });
  assert.deepEqual([...enabledTools.keys()], ["Agent", "get_subagent_result", "steer_subagent"]);
});

test("Agent tool description lists enabled effective profiles and refreshes when its factory reloads", async () => {
  const runtime = {
    async start() { throw new Error("unused"); },
    async get() { return null; },
    async steer() {},
    async notifyParent() {},
  };
  let profiles = [
    {
      name: "explore",
      displayName: "Explore",
      description: "Inspect the codebase",
      systemPrompt: "Explore",
      tools: ["read", "grep"],
      inheritContext: false,
      runInBackground: false,
      enabled: true,
      scope: "builtin",
    },
    {
      name: "disabled-agent",
      displayName: "Disabled agent",
      description: "Must stay hidden",
      systemPrompt: "Disabled",
      tools: [],
      model: "provider/hidden",
      inheritContext: false,
      runInBackground: false,
      enabled: false,
      scope: "project",
    },
  ];
  const extension = createSubagentExtension(runtime, () => profiles);

  const firstTools = new Map();
  await extension.factory({ registerTool(tool) { firstTools.set(tool.name, tool); }, sendMessage() {} });
  const first = firstTools.get("Agent");
  assert.match(first.description, /- explore: Inspect the codebase \(Tools: read, grep\)/);
  assert.doesNotMatch(first.description, /disabled-agent|Must stay hidden/);
  assert.match(first.parameters.properties.subagent_type.description, /Available types: explore/);

  profiles = [{
    name: "reviewer",
    displayName: "Reviewer",
    description: "Review a change",
    systemPrompt: "Review",
    tools: [],
    model: "provider/review-model",
    thinking: "high",
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "project",
  }];
  const reloadedTools = new Map();
  await extension.factory({ registerTool(tool) { reloadedTools.set(tool.name, tool); }, sendMessage() {} });
  const reloaded = reloadedTools.get("Agent");
  assert.match(reloaded.description, /- reviewer: Review a change \(Tools: none; Model: provider\/review-model; Thinking: high\)/);
  assert.doesNotMatch(reloaded.description, /explore/);
  assert.match(reloaded.parameters.properties.subagent_type.description, /Available types: reviewer/);
});

test("integrated extension removes a legacy extension that owns the same tools", () => {
  const host = {
    path: "<inline:pi-imagin-subagents>",
    tools: new Map([["Agent", {}], ["get_subagent_result", {}], ["steer_subagent", {}]]),
  };
  const legacy = {
    path: "/tmp/pi-subagents/index.ts",
    tools: new Map([["Agent", {}], ["get_subagent_result", {}], ["steer_subagent", {}]]),
  };
  const other = { path: "/tmp/other.ts", tools: new Map([["search", {}]]) };
  const lookalike = {
    path: "/tmp/unrelated/index.ts",
    tools: new Map([["Agent", {}], ["get_subagent_result", {}], ["steer_subagent", {}], ["custom", {}]]),
  };
  const result = preferPiImaginSubagentExtension({
    extensions: [legacy, lookalike, host, other],
    errors: [{ path: legacy.path, error: "duplicate" }, { path: other.path, error: "other" }],
  });

  assert.deepEqual(result.extensions.map((extension) => extension.path), [lookalike.path, host.path, other.path]);
  assert.deepEqual(result.errors.map((error) => error.path), [other.path]);
});

test("integrated extension removes recognized legacy extensions with any reserved tool", () => {
  const host = {
    path: "<inline:pi-imagin-subagents>",
    tools: new Map([["Agent", {}], ["get_subagent_result", {}], ["steer_subagent", {}]]),
  };
  for (const toolName of ["Agent", "get_subagent_result", "steer_subagent"]) {
    const legacy = {
      path: "/tmp/pi-subagents/index.ts",
      tools: new Map([[toolName, {}], ["other", {}]]),
    };
    const result = preferPiImaginSubagentExtension({
      extensions: [legacy, host],
      errors: [{
        path: host.path,
        error: `Tool "${toolName}" conflicts with ${legacy.path}`,
      }],
    });
    assert.deepEqual(result.extensions, [host]);
    assert.deepEqual(result.errors, []);
  }
});

test("foreground Agent streams updates and returns the completed result", async () => {
  const updates = [];
  let request;
  const { tools } = await loadTools({
    async start(value) {
      request = value;
      value.onUpdate(run({ status: "running" }));
      return {
        run: run(),
        completion: Promise.resolve(run({
          status: "completed",
          completedAt: "2026-01-01T00:01:00.000Z",
          result: "Parser is in lib/parser.ts",
        })),
      };
    },
    async get() { return null; },
    async steer() {},
  });
  const result = await tools.get("Agent").execute(
    "tool-call",
    {
      subagent_type: "explore",
      prompt: "Find the parser",
      input_files: ["docs/parser.md"],
      description: "Find parser",
    },
    undefined,
    (update) => updates.push(update),
    { sessionManager: { getSessionId: () => "parent-session" } },
  );

  assert.equal(request.parentToolCallId, "tool-call");
  assert.equal(request.task, "Find the parser");
  assert.equal(request.profile, "explore");
  assert.deepEqual(request.inputFiles, ["docs/parser.md"]);
  assert.equal("model" in request, false, "A call that names no model leaves the choice to the profile.");
  assert.equal("thinking" in request, false);
  assert.equal("maxTurns" in request, false);
  assert.equal("inheritContext" in request, false);
  assert.equal(updates[0].details.status, "running");
  // The session ID must be in the text so the model can pass it back to `resume` / `get_subagent_result`.
  assert.equal(result.content[0].text, "Subagent child-session completed.\n\nParser is in lib/parser.ts");
  assert.match(result.content[1].text, /Agent operation: create new session\. Actual session ID: child-session\./);
  assert.equal(result.details.status, "completed");
  assert.equal(result.isError, undefined);
});

test("a run may name a different model, which the tool forwards as an override", async () => {
  const started = [];
  const { tools } = await loadTools({
    async start(value) {
      started.push(value);
      return {
        run: run(),
        completion: Promise.resolve(run({
          status: "completed",
          completedAt: "2026-01-01T00:01:00.000Z",
          result: "Parser is in lib/parser.ts",
        })),
      };
    },
    async get() { return null; },
    async steer() {},
  });

  await tools.get("Agent").execute(
    "tool-call",
    { subagent_type: "explore", prompt: "Find the parser", description: "Find parser", model: "deepseek/deepseek-chat" },
    undefined,
    undefined,
    { sessionManager: { getSessionId: () => "parent-session" } },
  );

  // The profile still decides when the call names none (asserted by the foreground test above); this
  // is the one per-run override the tool keeps, so the runtime must receive it.
  assert.equal(started[0].model, "deepseek/deepseek-chat");
});

test("only the background notification text marks itself as not a user message", () => {
  const completed = run({ status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "Parser is in lib/parser.ts" });

  // Background completions land as a `custom` message, which pi replays to the model as a user turn;
  // without the marker a compaction pass files the report under Goal / Constraints (#875).
  assert.equal(subagentNotificationText(completed), `${SUBAGENT_NOTIFICATION_PREFIX}${subagentFinalText(completed)}`);
  assert.ok(SUBAGENT_NOTIFICATION_PREFIX.includes("not a message from the user"));
  assert.ok(subagentNotificationText(completed).endsWith("Parser is in lib/parser.ts"));
  // Tool results already carry the `toolResult` role, so they stay unprefixed.
  assert.ok(!subagentFinalText(completed).startsWith(SUBAGENT_NOTIFICATION_PREFIX));
});

test("worktree cleanup warnings reach both foreground text and background notifications", () => {
  const warning = "Worktree retained at /tmp/worktree: contains modified files";
  for (const status of ["completed", "failed", "aborted", "interrupted"]) {
    const result = run({ status, result: "Task result", error: "Task error", worktreeCleanupError: warning });
    assert.ok(subagentFinalText(result).endsWith(`Worktree cleanup warning: ${warning}`));
    assert.ok(subagentNotificationText(result).endsWith(`Worktree cleanup warning: ${warning}`));
  }
});

test("a resumed run's notification says it supersedes the earlier report (#985)", () => {
  const first = run({ runInBackground: true, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "Parser is in lib/parser.ts" });
  const resumed = { ...first, completedAt: "2026-01-01T00:20:00.000Z", result: "Parser moved to lib/parse.ts", resumed: true };

  const text = subagentNotificationText(resumed);

  assert.notEqual(text, subagentNotificationText({ ...resumed, resumed: undefined }));
  assert.ok(text.startsWith(SUBAGENT_NOTIFICATION_PREFIX));
  assert.match(text, /resumed run of subagent child-session; it supersedes any earlier report/);
  assert.ok(text.endsWith(subagentFinalText(resumed)));
  // A first run keeps its wording, and tool results never carry the resumed line.
  assert.equal(subagentNotificationText(first), `${SUBAGENT_NOTIFICATION_PREFIX}${subagentFinalText(first)}`);
  assert.doesNotMatch(subagentFinalText(resumed), /resumed run/);
});

test("foreground Agent reports startup and execution failures as tool errors", async () => {
  const { tools: startFailureTools } = await loadTools({
    async start() { throw new Error("profile missing"); },
    async get() { return null; },
    async steer() {},
  });
  const startup = await startFailureTools.get("Agent").execute(
    "tool-call",
    { prompt: "task", description: "desc" },
    undefined,
    undefined,
    { sessionManager: { getSessionId: () => "parent-session" } },
  );
  assert.equal(startup.isError, true);
  assert.equal(startup.content[0].text, "profile missing");

  const { tools: runFailureTools } = await loadTools({
    async start() {
      return {
        run: run(),
        completion: Promise.resolve(run({ status: "failed", error: "model failed" })),
      };
    },
    async get() { return null; },
    async steer() {},
  });
  const failure = await runFailureTools.get("Agent").execute(
    "tool-call",
    { prompt: "task", description: "desc" },
    undefined,
    undefined,
    { sessionManager: { getSessionId: () => "parent-session" } },
  );
  assert.equal(failure.isError, true);
  assert.match(failure.content[0].text, /model failed/);
});

test("Agent resume routes the prompt to the existing-session runtime", async () => {
  let resumed;
  const { tools } = await loadTools({
    async start() { throw new Error("must use resume"); },
    async resume(request) {
      resumed = request;
      return { run: run({ sessionId: "existing", runInBackground: false }), completion: Promise.resolve(run({ sessionId: "existing", status: "completed", result: "continued" })) };
    },
    async get() { return null; },
    async steer() {},
  });
  const result = await tools.get("Agent").execute(
    "tool-call",
    { resume: "existing", prompt: "Continue the review", description: "Continue review" },
    undefined,
    undefined,
    { sessionManager: { getSessionId: () => "parent-session" } },
  );
  assert.equal(resumed.sessionId, "existing");
  assert.equal(resumed.task, "Continue the review");
  assert.equal(result.content[0].text, "Subagent existing completed.\n\ncontinued");
  assert.match(result.content[1].text, /Agent operation: resume existing session\. Actual session ID: existing\./);
});

test("Agent resume failure never falls back to creating another session", async () => {
  const calls = [];
  const { tools } = await loadTools({
    async start() { calls.push("start"); throw new Error("must not create a replacement"); },
    async resume(request) { calls.push(`resume:${request.sessionId}`); throw new Error("Subagent not found"); },
  });
  const result = await tools.get("Agent").execute(
    "tool-call", { resume: "missing", prompt: "Continue", description: "Continue" },
    undefined, undefined, {},
  );
  assert.deepEqual(calls, ["resume:missing"]);
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Subagent not found");
});

test("background resume reports the existing session ID and operation", async () => {
  const existing = run({ sessionId: "existing", runInBackground: true, status: "completed" });
  const { tools } = await loadTools({
    async start() { throw new Error("must use resume"); },
    async resume(request) {
      assert.equal(request.sessionId, "existing");
      return { run: existing, completion: Promise.resolve(existing) };
    },
    async notifyParent() {},
  });
  const result = await tools.get("Agent").execute(
    "tool-call", { resume: "existing", prompt: "Continue", description: "Continue", run_in_background: true },
    undefined, undefined, {},
  );
  assert.equal(result.details.sessionId, "existing");
  assert.match(result.content[1].text, /Agent operation: resume existing session\. Actual session ID: existing\./);
});

test("background Agent returns immediately and delegates one completion notification", async () => {
  let finish;
  const notifications = [];
  const completion = new Promise((resolve) => { finish = resolve; });
  const { tools, sent } = await loadTools({
    async start() {
      return { run: run({ runInBackground: true }), completion };
    },
    async get() { return null; },
    async steer() {},
    async notifyParent(completed) { notifications.push(completed); },
  });
  const result = await tools.get("Agent").execute(
    "tool-call",
    { prompt: "task", description: "desc", run_in_background: true },
    undefined,
    undefined,
    { sessionManager: { getSessionId: () => "parent-session" } },
  );
  assert.match(result.content[0].text, /started in background/);
  assert.match(result.content[1].text, /Agent operation: create new session\. Actual session ID: child-session\./);
  assert.equal(sent.length, 0);

  finish(run({ runInBackground: true, status: "completed", result: "done" }));
  await completion;
  await Promise.resolve();
  assert.equal(sent.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].result, "done");
});

test("get_subagent_result covers missing, running, completed, failed, and aborted runs", async () => {
  let current = null;
  const { tools } = await loadTools({
    async start() { throw new Error("unused"); },
    async get() { return current; },
    async steer() {},
  });
  const tool = tools.get("get_subagent_result");

  let result = await tool.execute("call", { agent_id: "missing" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not found/);

  current = run();
  result = await tool.execute("call", { agent_id: "child-session" });
  assert.equal(result.details.status, "running");
  assert.equal(result.content[0].text, "Subagent child-session is running.");

  current = run({ status: "completed", result: "done" });
  result = await tool.execute("call", { agent_id: "child-session" });
  assert.equal(result.content[0].text, "Subagent child-session completed.\n\ndone");

  current = run({ status: "completed", result: "" });
  result = await tool.execute("call", { agent_id: "child-session" });
  assert.equal(result.content[0].text, "Subagent child-session completed without text output.");

  current = run({ status: "failed", error: "boom" });
  result = await tool.execute("call", { agent_id: "child-session" });
  assert.match(result.content[0].text, /boom/);
  assert.equal(result.isError, true);

  current = run({ status: "aborted" });
  result = await tool.execute("call", { agent_id: "child-session" });
  assert.match(result.content[0].text, /was stopped/);

  current = run({ status: "interrupted" });
  result = await tool.execute("call", { agent_id: "child-session" });
  assert.match(result.content[0].text, /interrupted before completion/);
});

test("get_subagent_result wait honors abort signals", async () => {
  const { tools } = await loadTools({
    async start() { throw new Error("unused"); },
    async get() { return run(); },
    async steer() {},
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    tools.get("get_subagent_result").execute("call", { agent_id: "child-session", wait: true }, controller.signal),
    /Result wait aborted/,
  );
});

test("steer_subagent returns success and runtime failures", async () => {
  const calls = [];
  const { tools } = await loadTools({
    async start() { throw new Error("unused"); },
    async get() { return null; },
    async steer(id, message) {
      calls.push([id, message]);
      if (message === "fail") throw new Error("not running");
    },
  });
  const tool = tools.get("steer_subagent");
  const success = await tool.execute("call", { agent_id: "child-session", message: "focus" });
  assert.deepEqual(calls[0], ["child-session", "focus"]);
  assert.match(success.content[0].text, /sent/);

  const failure = await tool.execute("call", { agent_id: "child-session", message: "fail" });
  assert.equal(failure.isError, true);
  assert.equal(failure.content[0].text, "not running");
});

test("legacy preference leaves unrelated and partial-overlap extensions intact", () => {
  const host = { path: "<inline:pi-imagin-subagents>", tools: new Map() };
  const partial = { path: "/tmp/partial.ts", tools: new Map([["Agent", {}]]) };
  const base = { extensions: [host, partial], errors: [] };
  assert.equal(preferPiImaginSubagentExtension(base), base);

  const noHost = { extensions: [partial], errors: [] };
  assert.equal(preferPiImaginSubagentExtension(noHost), noHost);
});

function consumingRuntime(runInfo, consumed) {
  return {
    async start() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async get() { return runInfo; },
    async steer() {},
    async notifyParent() {},
    markResultConsumed(collected) { consumed.push(collected); },
  };
}

test("collecting a finished background result marks it consumed so the completion notification is skipped", async () => {
  const consumed = [];
  const finished = run({
    runInBackground: true,
    status: "completed",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Parser found",
  });
  const { tools } = await loadTools(consumingRuntime(finished, consumed));

  const result = await tools.get("get_subagent_result").execute("call", { agent_id: "child-session" });

  assert.equal(result.content[0].text, "Subagent child-session completed.\n\nParser found");
  // The mark names the collected run, so a later run of the same session is not affected.
  assert.deepEqual(consumed.map(({ sessionId, completedAt }) => ({ sessionId, completedAt })), [
    { sessionId: "child-session", completedAt: "2026-01-01T00:01:00.000Z" },
  ]);
});

test("a background result that is still running is not marked consumed", async () => {
  const consumed = [];
  const { tools } = await loadTools(consumingRuntime(run({ runInBackground: true, status: "running" }), consumed));

  await tools.get("get_subagent_result").execute("call", { agent_id: "child-session" });

  assert.deepEqual(consumed, []);
});

test("a foreground result is not marked consumed because it never notifies the parent", async () => {
  const consumed = [];
  const finished = run({
    runInBackground: false,
    status: "failed",
    completedAt: "2026-01-01T00:01:00.000Z",
    error: "stream disconnected",
  });
  const { tools } = await loadTools(consumingRuntime(finished, consumed));

  const result = await tools.get("get_subagent_result").execute("call", { agent_id: "child-session" });

  assert.equal(result.isError, true);
  assert.deepEqual(consumed, []);
});
