/**
 * Acceptance Test - ARGO 0.27.0-beta.14 上下文输出预算（maxBytes/truncation）对中心透明
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个隔离的 ARGO_ROOT（其 systemarchitecture-mcp-server 为桩，回显收到的参数）
 *       + 一个已同步的成员副本工作区
 * WHEN 中心经镜像引擎 POST /graph/read 传入 beta.14 新增的可选参数 maxBytes
 * THEN
 *   1. 中心把 args 原样转发给 ARGO callTool（maxBytes 未被吞掉或改写），并注入 workspaceRoot
 *   2. ARGO 返回的带 `truncation`（identity 降级）的结果被中心原样透传，不做二次改写
 *   3. 若转录缺少可识别形状也不影响透传（中心对结果内容不做假设）
 *
 * 依据：ARGO 0.27.0-beta.13 起 getIntentElementContext/getArchitectureViewContext 新增
 * maxBytes 输出预算（超限将非焦点成员降级为 id/type/name 并在 truncation 给出清单），
 * beta.14 增加 overBudgetByFocus。中心只做 args 透传与结果透传，属自动适配。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

async function waitHealth(base, attempts) {
  for (let i = 0; i < attempts; i += 1) { try { const r = await fetch(`${base}/health`); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

function writeStubEngine(argoRoot, receivedPath) {
  const scripts = path.join(argoRoot, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  // The engine eagerly requires all three modules; provide minimal stubs.
  fs.writeFileSync(path.join(scripts, 'ensureArgoHarnessEnvironment.js'), 'module.exports = { buildHarnessReport: async () => ({}) };\n', 'utf8');
  fs.writeFileSync(path.join(scripts, 'neo4j-system-architecture-store.js'), 'module.exports = { getNeo4jConfig: () => ({}), createDriver: () => ({ session: () => ({ run: async () => ({ records: [] }), close: async () => {} }), close: async () => {} }) };\n', 'utf8');
  fs.writeFileSync(path.join(scripts, 'systemarchitecture-mcp-server.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    `const RECEIVED = ${JSON.stringify(receivedPath)};`,
    'exports.callTool = async (name, args) => {',
    '  fs.writeFileSync(RECEIVED, JSON.stringify({ name, args }), "utf8");',
    '  return {',
    '    status: "passed",',
    '    tool: name,',
    '    echo: { maxBytes: args.maxBytes, workspaceRoot: args.workspaceRoot },',
    '    truncation: { truncated: true, reason: "context_budget_exceeded", maxBytes: args.maxBytes, includedElementIds: ["focus-001"] },',
    '  };',
    '};',
    '',
  ].join('\n'), 'utf8');
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-budget-'));
  const argoRoot = path.join(tmp, '.argo');
  const mirrorsRoot = path.join(tmp, 'mirrors');
  const logDir = path.join(tmp, 'logs');
  const receivedPath = path.join(tmp, 'received.json');
  writeStubEngine(argoRoot, receivedPath);
  fs.mkdirSync(path.join(mirrorsRoot, 'Y', 'design', 'KG'), { recursive: true });
  fs.writeFileSync(path.join(mirrorsRoot, 'Y', 'design', 'KG', 'SystemArchitecture.json'), '{}\n', 'utf8');

  const port = 25000 + Math.floor(Math.random() * 8000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'mirror-engine-server.js')], {
    env: { ...process.env, ARGO_ROOT: argoRoot, MIRRORS_ROOT: mirrorsRoot, MIRROR_ENGINE_HOST: '127.0.0.1', MIRROR_ENGINE_PORT: String(port), GRAPH_STORE_LOG_DIR: logDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    check(await waitHealth(base, 25), 'engine ready');

    const res = await fetch(`${base}/graph/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'Y', tool: 'getIntentElementContext', args: { elementId: 'focus-001', maxBytes: 1234 } }),
    });
    const json = await res.json();

    check(res.status === 200 && json.status === 'ok', 'THEN0 /graph/read 返回 ok');
    const received = JSON.parse(fs.readFileSync(receivedPath, 'utf8'));
    check(received.name === 'getIntentElementContext', 'THEN1 tool 名原样转发');
    check(received.args.maxBytes === 1234, 'THEN1 可选参数 maxBytes 原样转发（未被吞掉/改写）');
    check(typeof received.args.workspaceRoot === 'string' && received.args.workspaceRoot.endsWith(path.join('mirrors', 'Y')), 'THEN1 中心按 projectId 注入 workspaceRoot');

    check(json.result && json.result.truncation && json.result.truncation.reason === 'context_budget_exceeded', 'THEN2 带 truncation 的结果原样透传');
    check(json.result.truncation.maxBytes === 1234, 'THEN2 透传结果未被中心改写（maxBytes 保持）');
  } finally {
    child.kill();
    await new Promise((resolve) => { let done = false; const f = () => { if (!done) { done = true; resolve(); } }; child.once('exit', f); setTimeout(f, 800); });
  }

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: beta.14 上下文预算（maxBytes/truncation）对中心透明验收通过。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
