import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider: LocaleProvider } = await jiti.import("@/hooks/useI18n");
// 英文断言显式设置应用语言；与组件使用相同导入路径，确保共享同一上下文。
const I18nProvider = (props) => React.createElement(LocaleProvider, { initialLocale: "en", ...props });
const { McpAddServer } = await jiti.import("./McpAddServer.tsx");
const { McpConfigView } = await jiti.import("./McpConfig.tsx");
const { EMPTY_MCP_ADD_DRAFT } = await jiti.import("./mcp-add-helpers.ts");

const h = React.createElement;
const noop = () => {};

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html) {
  // A line-break opportunity is no space: the save target's path holds one after each folder.
  return decode(html.replace(/<wbr\/>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const globalFile = { scope: "global", path: "/Users/me/.pi/agent/mcp.json", exists: true, problems: [] };
const projectFile = { scope: "project", path: "/Users/me/repo/.pi/mcp.json", exists: false, problems: [] };
const fresh = { requiresTrust: false, trusted: true, decision: null, inherited: false };

function overview(project = { cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: true } }, overrides = {}) {
  return {
    mcp: { available: true },
    codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" },
    files: [globalFile, projectFile],
    servers: [],
    ...(project ? { project } : {}),
    ...overrides,
  };
}

function pane(props = {}) {
  return renderToStaticMarkup(h(I18nProvider, null, h(McpAddServer, {
    data: overview(),
    cwd: "/Users/me/repo",
    draft: EMPTY_MCP_ADD_DRAFT,
    busy: false,
    controlsBusy: false,
    failure: null,
    onDraftChange: noop,
    onSubmit: noop,
    ...props,
    ...(props.draft ? { draft: { ...EMPTY_MCP_ADD_DRAFT, ...props.draft } } : {}),
  })));
}

/** The Add button's opening tag and label. */
function addButton(html) {
  const match = decode(html).match(/<button type="button"([^>]*)class="config-button config-button-primary[^"]*"([^>]*)>([^<]*)<\/button>/);
  assert.ok(match, "the pane has its Add button");
  return { tag: `${match[1]} ${match[2]}`, label: match[3] };
}

test("the paste box is a textarea that never takes focus by itself on a phone, and Add waits for a paste", () => {
  const html = decode(pane());
  assert.match(html, /<textarea id="mcp-add-source" aria-label="Server to add" class="config-add-source-input is-multiline"/);
  assert.doesNotMatch(html, /autofocus|autoFocus/i, "focus is decided on mount, by pointer, never in the markup");
  // The catalogs to browse, in order, at the right of the title.
  assert.deepEqual(
    [...html.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]),
    [
      ["https://glama.ai/mcp/servers", "glama.ai"],
      ["https://smithery.ai/servers", "smithery.ai"],
      ["https://mcp.so/", "mcp.so"],
      ["https://registry.modelcontextprotocol.io/", "MCP Registry"],
      ["https://github.com/mcp", "github.com/mcp"],
    ],
  );
  // The placeholder lists what may be pasted; no sentence under the box repeats it.
  assert.doesNotMatch(html, /config-add-source-hint|Cmd\/Ctrl\+Enter adds it/);
  assert.match(html, /<details class="mcp-add-examples">/, "示例默认折叠");
  // Every supported format, each named as the preview would name it.
  assert.match(html, /<summary>Examples<\/summary>/);
  assert.match(html, /<span class="config-add-source-example-label">codex mcp add<\/span><code class="config-add-source-example-value">codex mcp add fetch -- uvx mcp-server-fetch<\/code>/);
  assert.match(html, /<span class="config-add-source-example-label">Zed settings<\/span>/);
  assert.equal(html.match(/class="mcp-add-example"/g)?.length, 19);
  assert.match(addButton(html).tag, /disabled=""/);
  assert.equal(addButton(html).label, "Add and test");
  // An empty box is no refusal: nothing explains Add yet but the hint.
  assert.doesNotMatch(text(html), /Nothing to add yet/);
});

test("before Add the pane shows what would be written: the target as written, names, shell commands, notes", () => {
  const paste = JSON.stringify({
    mcpServers: {
      lint: { command: "npx", args: ["-y", "@acme/lint-mcp", "--api-key=sk-0123456789abcdef0123"], env: { NODE_ENV: "production", HOOK: "!curl x | sh" } },
    },
  });
  const html = pane({ draft: { text: paste } });
  const shown = text(html);
  // The preview, not the box the user pasted into.
  const preview = text(decode(html).slice(decode(html).indexOf("Preview")));
  assert.match(preview, /Read as an mcpServers config/);
  // As written: the pasted text is on the page already, and masking would let a link's author hide what runs.
  assert.match(preview, /Command npx -y @acme\/lint-mcp --api-key=sk-0123456789abcdef0123/);
  assert.doesNotMatch(preview, /Parts that look like secrets are hidden/);
  assert.match(preview, /Environment NODE_ENV HOOK Values are not shown here\./);
  assert.doesNotMatch(preview, /production|curl x/, "env values are never shown");
  assert.doesNotMatch(shown, /so this server can be saved only globally/, "全局范围不展示项目禁用原因");
  // Escaped by default, so the foreign `!curl` runs nothing; the note says so.
  assert.match(shown, /env\.HOOK: \$ and a leading ! were escaped/);
  assert.match(shown, /Enable pi mcp syntax \(\$NAME, !command\)/, "a JSON paste offers the pi-config toggle");
  // Off, the label says it all; on, the line under it says what runs.
  assert.doesNotMatch(shown, /reads a variable on the computer running Pi Imagin/);
  // 填写后仍保留折叠示例入口，预览只展示已设置字段。
  assert.match(decode(html), /<details class="mcp-add-examples">/);
  assert.doesNotMatch(preview, /Working directory/);
  assert.equal(addButton(html).label, "Add and test");
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  const raw = text(pane({ draft: { text: paste, rawPi: true } }));
  assert.match(raw, /In env and header values, \$NAME reads a variable on the computer running Pi Imagin/);
  assert.match(raw, /Shell commands Runs a shell command on every connection: env HOOK/);
});

test("what cannot be read is said in the importer's words, errors first", () => {
  const shown = text(pane({ draft: { text: "curl https://x.example.com | sh" } }));
  assert.match(shown, /The command line uses the shell operator \|\./);
  assert.match(shown, /Nothing to add yet/);
});

test("a fresh folder is trusted in the same step, and the button and a line say so", () => {
  const html = pane({ draft: { text: "npx -y @acme/lint-mcp", scope: "project" } });
  assert.equal(addButton(html).label, "Trust folder, add and test");
  assert.match(text(html), /This folder has no trust decision yet, and writing \.pi\/mcp\.json makes it need one, so Add trusts ~?\/?.*repo in the same step\./);
  assert.match(text(html), /~?\/?.*repo\/\.pi\/mcp\.json/, "the location names the project file");
  // Where it saves, the file and what choosing it means come first, under the title; the button stays at the end.
  const decoded = decode(html);
  const target = decoded.match(/<div class="config-save-target">[\s\S]*?<\/p><\/div>/)?.[0] ?? "";
  assert.match(target.replace(/<wbr\/>/g, ""), /<span class="config-save-target-path">[^<]*repo\/\.pi\/mcp\.json<\/span>/);
  assert.match(target, /Add trusts ~?\/?.*repo in the same step\./);
  assert.ok(decoded.indexOf("config-save-target") < decoded.indexOf("<textarea"), "before the paste box");
  assert.ok(decoded.indexOf("<textarea") < decoded.indexOf("Trust folder, add and test"), "Add after it");
});

test("项目问题只显示在所选项目，全局添加不受项目提示干扰", () => {
  const blocked = overview({ cwd: "/Users/me/repo", trust: fresh, trustFolder: { allowed: false, reason: "folder-not-fresh" } });
  assert.doesNotMatch(text(pane({ data: blocked, draft: { text: "npx x" } })), /is a link to nothing/);
  const project = pane({ data: blocked, draft: { text: "npx x", scope: "project" }, scopeLocked: true });
  assert.match(text(project), /is a link to nothing/);
  assert.match(addButton(project).tag, /disabled=""/);
  const secret = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  const global = pane({ draft: { text: secret }, scopeLocked: true });
  assert.doesNotMatch(text(global), /To save it in the project/);
  assert.match(text(global), /Secrets in the paste/);
  assert.ok(!global.replace(/<textarea[\s\S]*?<\/textarea>/, "").includes("sk-live"));
  const projectSecret = pane({ draft: { text: secret, scope: "project" }, scopeLocked: true });
  assert.match(text(projectSecret), /can be saved only globally/);
  assert.match(addButton(projectSecret).tag, /disabled=""/);
});

test("the name comes right after the paste, with the importer's notes about it, which go once it is edited", () => {
  const paste = JSON.stringify({ mcpServers: { "My Server!": { command: "npx", args: ["-y", "@acme/lint-mcp"] } } });
  let shown = text(pane({ draft: { text: paste } }));
  assert.match(shown, /Server to add .* Name My Server! became My-Server: pi server names use letters, digits, _ and -\. Preview /);
  assert.equal(shown.match(/became My-Server/g)?.length, 1, "said once, under the name, not again with the preview's notes");
  // Typed over, the note would describe a name no longer in the box.
  shown = text(pane({ draft: { text: paste, name: "lint" } }));
  assert.doesNotMatch(shown, /became My-Server/);
  assert.match(shown, /Name Preview /);
});

test("a password field takes a host variable instead, and the name field says when the name is taken", () => {
  const paste = JSON.stringify({
    servers: { gh: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer ${input:pat}" } } },
    inputs: [{ id: "pat", type: "promptString", password: true, description: "GitHub personal access token" }],
  });
  let html = decode(pane({ draft: { text: paste } }));
  // The box shows what the paste held there; the line under it, what is stored around the value.
  assert.match(html, /<input class="mcp-add-input" type="password" aria-label="pat" autoComplete="off" placeholder="\$\{input:pat\}"[^>]*value=""\/>/);
  assert.match(text(html), /GitHub personal access token/);
  assert.match(text(html), /Stored as Bearer ‹your value›\./);
  assert.match(text(html), /Read it from a variable of the computer running Pi Imagin/);
  assert.match(text(html), /Fill in pat first\./);
  html = decode(pane({ draft: { text: paste, references: { "input.pat": "GH_TOKEN" } } }));
  assert.match(html, /aria-label="Variable for pat"[^>]*value="GH_TOKEN"\/>/);
  assert.match(text(html), /Stored as Bearer \$\{GH_TOKEN\}: pi reads the variable each time it connects/);
  // The preview then says the header sends that variable.
  assert.match(text(html), /Host variables Sends environment variables of the computer running Pi Imagin to this server on every connection: GH_TOKEN in header Authorization/);
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  html = pane({ data: overview(undefined, { servers: [{ name: "gh", scope: "global" }] }), draft: { text: paste, references: { "input.pat": "GH_TOKEN" } } });
  assert.match(text(html), /\.pi\/agent\/mcp\.json already has a server named gh\./);
  assert.match(text(html), /Use gh-2/);
});

test("a placeholder in a header says only what to type: the box holds the placeholder, the line what is stored around it", () => {
  const paste = `claude mcp add-json github '{"type":"http","url":"https://api.githubcopilot.com/mcp","headers":{"Authorization":"Bearer YOUR_GITHUB_PAT"}}'`;
  let html = decode(pane({ draft: { text: paste } }));
  assert.match(html, /aria-label="Authorization" autoComplete="off" placeholder="YOUR_GITHUB_PAT"[^>]*value=""\/>/);
  assert.match(text(html), /Stored as Bearer ‹your value›\. Optional: left blank, the Authorization header is not sent\. Read it from a variable/);
  // No reason for a plain placeholder, no "In the paste" line repeating the box, no warning repeating the scope switch.
  assert.doesNotMatch(text(html), /placeholder here|In the paste|Stored as typed|value it belongs to/);
  // Once typed, the scope switch says the secret keeps the server global, once.
  html = decode(pane({ draft: { text: paste, values: { "headers.Authorization": "ghp_x" } } }));
  assert.doesNotMatch(text(html), /To save it in the project/);

  // A value the field makes up whole needs no line: the box says it all.
  const whole = JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_KEY: "<your-api-key>" } } } });
  html = decode(pane({ draft: { text: whole } }));
  assert.match(html, /aria-label="API_KEY" autoComplete="off" placeholder="<your-api-key>"[^>]*value=""\/>/);
  assert.doesNotMatch(text(html), /Stored as|Optional:/);
});

test("a pasted secret read from a variable says how it is stored, and a name pi refuses says so under its box", () => {
  const secret = JSON.stringify({ mcpServers: { api: { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  let html = decode(pane({ draft: { text: secret, scope: "project", secretReferences: { "headers.Authorization": "API_TOKEN" } } }));
  assert.match(html, /aria-label="Variable for headers\.Authorization"[^>]*value="API_TOKEN"\/>/);
  assert.match(text(html), /Stored as Bearer \$\{API_TOKEN\}: pi reads the variable each time it connects/);
  assert.equal(addButton(html).label, "Trust folder, add and test");
  assert.doesNotMatch(addButton(html).tag, /disabled/);

  html = decode(pane({ draft: { text: secret, secretReferences: { "headers.Authorization": "api-token" } } }));
  const problem = html.match(/aria-invalid="true" aria-describedby="([^"]+)"/);
  assert.ok(problem, "the box points at its reason");
  assert.match(html, new RegExp(`<span id="${problem[1]}" class="mcp-config-line is-error">headers\\.Authorization: a variable name has letters`));
  assert.match(text(html), /Correct headers\.Authorization first\./);
  assert.doesNotMatch(text(html), /Fill in headers\.Authorization/);

  const field = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GITHUB_TOKEN: "YOUR_TOKEN" } } } });
  html = decode(pane({ draft: { text: field, references: { "env.GITHUB_TOKEN": "my-token" } } }));
  assert.match(html, /aria-label="Variable for GITHUB_TOKEN"[^>]*aria-invalid="true" aria-describedby="[^"]+"/);
  assert.match(text(html), /GITHUB_TOKEN: a variable name has letters, digits and _/);
  assert.match(text(html), /Correct GITHUB_TOKEN first\./);
});

test("a variable box opens with the name it suggests, and an emptied one asks for a name instead of refusing it", () => {
  // The e2e case: a literal env secret, read from a variable instead.
  const secret = JSON.stringify({ mcpServers: { api: { command: "npx", args: ["api"], env: { API_TOKEN: "sk-live-0123456789abcdef0123" } } } });
  let html = decode(pane({ draft: { text: secret, secretReferences: { "env.API_TOKEN": "" } } }));
  assert.match(html, /aria-label="Variable for env\.API_TOKEN" placeholder="API_TOKEN"[^>]*value=""\/>/);
  assert.match(text(html), /env\.API_TOKEN: enter the name of the variable to read it from\./);
  assert.doesNotMatch(text(html), /a variable name has letters/);
  assert.match(text(html), /Fill in env\.API_TOKEN first\./);
  // Ticking the box puts the suggestion in it (`suggestedName ?? ""`), which the pane takes as it is.
  html = decode(pane({ draft: { text: secret, secretReferences: { "env.API_TOKEN": "API_TOKEN" } } }));
  assert.doesNotMatch(html, /aria-invalid/);
  assert.match(text(html), /Stored as \$\{API_TOKEN\}/);
  // A header's suggestion is made from the server's name; a field's from where its value goes.
  const header = JSON.stringify({ mcpServers: { docs: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer sk-live-0123456789abcdef0123" } } } });
  assert.match(decode(pane({ draft: { text: header, secretReferences: { "headers.Authorization": "" } } })), /aria-label="Variable for headers\.Authorization" placeholder="DOCS_TOKEN"[^>]*value=""\/>/);
  const field = JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["gh"], env: { GH_PAT: "YOUR_TOKEN" } } } });
  html = decode(pane({ draft: { text: field, references: { "env.GH_PAT": "" } } }));
  assert.match(html, /aria-label="Variable for GH_PAT" placeholder="GH_PAT"[^>]*value=""\/>/);
  assert.match(text(html), /GH_PAT: enter the name of the variable to read it from\./);
});

test("a refused Add says why; host variables are added only through an explicit second button", () => {
  let html = pane({
    draft: { text: "https://api.example.com/mcp" },
    failure: { error: "x", reason: "host-env-confirm", names: ["GH_TOKEN"] },
  });
  assert.match(decode(html), /<div role="alert" class="mcp-add-failure">/);
  assert.match(text(html), /Not added: The server would be sent variables of the computer running Pi Imagin; confirm that first\./);
  assert.match(text(html), /read GH_TOKEN, which are set on the computer running Pi Imagin/);
  assert.match(text(html), /Add and send these values/);

  html = pane({ draft: { text: "npx x", scope: "project" }, failure: { error: "x", reason: "trust-too-broad", breadth: { kind: "contains-agent-dir", path: "/Users/me/.pi/agent" } } });
  assert.match(text(html), /Not added: This folder holds Pi's agent folder \(~?\/?.*\.pi\/agent\)/);
  html = pane({ draft: { text: "{" }, failure: { error: "x", reason: "import-failed", notes: [{ code: "invalid-json", params: { detail: "Unexpected end" } }] } });
  assert.match(text(html), /This looks like JSON but does not parse: Unexpected end/);
  html = pane({ draft: { text: "x" }, failure: { error: "x", timedOut: true } });
  assert.match(text(html), /Not added: Pi Imagin did not answer in time/);
  // The write failed after trusting, and the trust could not be taken back: said in words, not only in the diagnostic.
  html = pane({
    draft: { text: "npx x", scope: "project" },
    failure: { error: "x; the folder stays trusted", reason: "locked", trustKept: true, trust: { requiresTrust: false, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false } },
  });
  assert.match(text(html), /Not added: .* Pi Imagin trusted ~?\/?.*repo for this step and could not take that back, so the folder stays trusted\./);
  assert.doesNotMatch(text(html), /the folder stays trusted$/m, "not the English diagnostic");

  // Refusals worded as an Add's, not as the switch's, Test's or a session's.
  html = pane({ draft: { text: "https://api.example.com/mcp" }, failure: { error: 'server "server": url must be an http or https URL', reason: "server-invalid", name: "server" } });
  assert.match(text(html), /Not added: pi refuses it as filled in: server "server": url must be an http or https URL/);
  assert.doesNotMatch(text(html), /does not connect it/);
  html = pane({ draft: { text: "https://api.example.com/mcp" }, failure: { error: "x", reason: "web-password", name: "server" } });
  assert.match(text(html), /Not added: It references PI_WEB_PASSWORD, so Pi Imagin does not add it\./);
});

test("Settings › MCP opens the add pane from the sidebar, keeps the draft, and says what Add wrote", () => {
  const html = renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: null,
    load: { state: "loaded", data: overview(null) },
    selected: null,
    refreshing: false,
    embedded: true,
    adding: true,
    addDraft: { ...EMPTY_MCP_ADD_DRAFT, text: "npx -y @acme/lint-mcp" },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
  })));
  assert.match(decode(html), /<button type="button" aria-current="page" class="config-list-action-button">[\s\S]*?Add MCP<\/button>/);
  // The name first, under the paste box, with the note on where it came from; then the preview, which
  // leaves out what is not set: no working directory and no env names, rather than "None".
  const withoutExamples = html.replace(/<details class="mcp-add-examples">[\s\S]*?<\/details>/, "");
  assert.match(text(withoutExamples), /Server to add npx -y @acme\/lint-mcp Name Named lint after its address or command\. Preview Transport stdio Command npx -y @acme\/lint-mcp Parsing details Read as a command line Adding tests the connection once\. Cancel Add and test /);
  assert.match(decode(html), /aria-label="Name"[^>]*value="lint"\/>/);
  // The added notice: the server and its file, the folder trusted with it, the test, and Sign in.
  const addedView = (props = {}) => renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: "/Users/me/repo",
    load: {
      state: "loaded",
      data: overview({ cwd: "/Users/me/repo", trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: "/Users/me/repo", inherited: false } }, {
        servers: [{
          name: "docs", scope: "project", sourcePath: projectFile.path, configKey: "k", enabled: true, validated: true,
          transport: "http", url: "https://docs.example.com/mcp", envNames: [], headerNames: [], usesOAuth: true,
          commandFields: [], variableReferences: [], masked: false,
          status: { origin: "test", state: "needs-auth", tools: [], toolCount: 0, testedAt: Date.now(), durationMs: 10 },
        }],
      }),
    },
    selected: "project\0docs",
    refreshing: false,
    embedded: true,
    added: { scope: "project", name: "docs", path: projectFile.path, key: "project\0docs", trustedFolder: "/Users/me/repo" },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
    ...props,
  })));
  const notice = addedView();
  // Short on a phone: the project file from the panel's folder, and that folder as the button named it.
  assert.match(text(notice), /Added docs to \.\/\.pi\/mcp\.json, and trusted this folder\. It asks for a sign-in\./);
  assert.match(decode(notice), /<div role="status" class="config-notice has-action">[\s\S]*?<button type="button" class="config-button config-button-primary config-button-small">Sign in<\/button>/);
  // Outside the home folder too, where `~` shortens nothing (the e2e run's folder). The detail
  // pane's File row still shows the whole path.
  const far = "/private/tmp/work/some/long/folder/project";
  const farView = decode(renderToStaticMarkup(h(I18nProvider, null, h(McpConfigView, {
    cwd: far,
    load: {
      state: "loaded",
      data: overview({ cwd: far, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: far, inherited: false } }, {
        files: [globalFile, { ...projectFile, path: `${far}/.pi/mcp.json`, exists: true }],
        servers: [{
          name: "docs", scope: "project", sourcePath: `${far}/.pi/mcp.json`, configKey: "k", enabled: true, validated: true,
          transport: "http", url: "https://docs.example.com/mcp", envNames: [], headerNames: [], usesOAuth: false,
          commandFields: [], variableReferences: [], masked: false,
        }],
      }),
    },
    selected: "project\0docs",
    refreshing: false,
    embedded: true,
    added: { scope: "project", name: "docs", path: `${far}/.pi/mcp.json`, key: "project\0docs", trustedFolder: far },
    onSelect: noop,
    onRefresh: noop,
    onCodemodeChange: noop,
    onClose: noop,
  }))));
  const farNotice = farView.match(/<div role="status" class="config-notice[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal(text(farNotice), "Added docs to ./.pi/mcp.json, and trusted this folder.");
  assert.match(text(farView), new RegExp(`File ${far.replace(/[/.]/g, "\\$&")}\\/\\.pi\\/mcp\\.json`));
  // A global Add names its file as the other panels do, and a folder other than the panel's by its path.
  const globalNotice = text(addedView({ added: { scope: "global", name: "docs", path: globalFile.path, key: "project\0docs" } }));
  assert.match(globalNotice, /Added docs to ~\/\.pi\/agent\/mcp\.json\./);
  const elsewhere = text(addedView({ added: { scope: "project", name: "docs", path: projectFile.path, key: "project\0docs", trustedFolder: "/Users/me/other" } }));
  assert.match(elsewhere, /Added docs to \.\/\.pi\/mcp\.json, and trusted ~\/other\./);
  // A Sign out of the same server on its way would cancel a sign-in started now, so the notice's
  // Sign in waits for it, as the row's does.
  const signingOut = decode(addedView({ busy: "sign-out:project\0docs" }));
  assert.match(text(signingOut), /It asks for a sign-in\./);
  assert.doesNotMatch(signingOut.slice(signingOut.indexOf("Added docs"), signingOut.indexOf("</div>", signingOut.indexOf("Added docs"))), /Sign in</);
});


test("演示地址不可添加，替换真实地址后可提交", () => {
  const demo = pane({ draft: { text: "https://mcp.example.com/mcp" }, scopeLocked: true });
  assert.match(addButton(demo).tag, /disabled=""/);
  assert.doesNotMatch(text(demo), /This is an example address/);
  const real = pane({ draft: { text: "https://docs.example.test/mcp" }, scopeLocked: true, onCancel: noop });
  assert.doesNotMatch(addButton(real).tag, /disabled=""/);
  assert.match(text(real), /Cancel Add and test/);
  assert.match(decode(real), /class="mcp-add-advanced"><summary>Parsing details/);
});
