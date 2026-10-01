/**
 * Acceptance Test - 跨项目图谱查询（120 Graph Store 代理 + ARGO 镜像引擎）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个 stub 镜像引擎 + 120 Graph Store 服务（MIRROR_ENGINE_URL 指向 stub）+ 已登记成员 A/B
 * WHEN 依次执行 授权 → 跨项目读取 → 未授权读取 → 未知成员 → 写工具 → 注册 → 注销
 * THEN
 *   1. GIVEN A 已授权 B；WHEN B 带 projectId=A 读；THEN 200 ok 且请求被转发到引擎（tool/args 透传）
 *   2. GIVEN 未授权；WHEN 读取；THEN 403 denied/not_authorized 且**不触达引擎**（授权在 120 判定）
 *   3. GIVEN 未知成员；WHEN 读取；THEN 403 member_not_found
 *   4. GIVEN 非白名单读工具；WHEN 读取；THEN 400（引擎拒绝）
 *   5. GIVEN 成员注册；WHEN registry_register；THEN 自动触发一次引擎镜像同步（副本建设）
 *   6. GIVEN 成员注销；WHEN registry_deregister；THEN 调用引擎移除镜像
 *   7. 意图图已登记「跨项目图谱查询」视图及关键元素
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const registry = require('../../mcp/registry.js');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');
const READ_TOOLS = ['getSystemArchitecture', 'getIntentElementContext', 'getArchitectureViewContext', 'queryNeo4jGraph', 'memory_search'];

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

function startStub() {
  return new Promise((resolve) => {
    const calls = { sync: [], remove: [], read: [] };
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const b = body ? JSON.parse(body) : {};
        const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
        if (req.method === 'POST' && req.url === '/mirror/sync') { calls.sync.push(b); return send(200, { status: 'ok', synced: true, projectId: b.projectId, commit: 'stub' }); }
        if (req.method === 'POST' && req.url === '/mirror/remove') { calls.remove.push(b); return send(200, { status: 'ok', projectId: b.projectId, removed: true }); }
        if (req.method === 'POST' && req.url === '/graph/read') {
          calls.read.push(b);
          if (!READ_TOOLS.includes(b.tool)) return send(200, { status: 'bad_request', reason: `tool_not_allowed:${b.tool}` });
          return send(200, { status: 'ok', projectId: b.projectId, tool: b.tool, result: { echo: b.args } });
        }
        if (req.method === 'GET' && req.url === '/mirrors') return send(200, { status: 'ok', count: calls.sync.length, mirrors: [] });
        return send(404, { error: 'nf' });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port }));
  });
}

async function mcp(base, name, args) {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }) });
  const j = await r.json();
  const t = j && j.result && j.result.content && j.result.content[0] && j.result.content[0].text;
  return t ? JSON.parse(t) : j;
}
async function rest(base, body) {
  const r = await fetch(`${base}/graph/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { httpStatus: r.status, json: j };
}
async function waitHealth(base, attempts) {
  for (let i = 0; i < attempts; i += 1) { try { const r = await fetch(`${base}/health`); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

async function main() {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xg-read-'));
  const registryPath = path.join(assetRoot, 'registry', 'registry.json');
  let reg = registry.emptyRegistry();
  registry.registerMember(reg, { id: 'A', name: '项目 A', sourceRepo: '/tmp/a' });
  registry.registerMember(reg, { id: 'B', name: '项目 B', sourceRepo: '/tmp/b' });
  registry.save(registryPath, reg);

  const stub = await startStub();
  const port = 21000 + Math.floor(Math.random() * 15000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'asset-mcp-server.js')], {
    env: { ...process.env, ASSET_REPO_ROOT: assetRoot, ASSET_ROOT: assetRoot, ASSET_MCP_HOST: '127.0.0.1', ASSET_MCP_PORT: String(port), MIRROR_ENGINE_URL: `http://127.0.0.1:${stub.port}` },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    check(await waitHealth(base, 25), 'server ready');

    // THEN 2: 未授权默认拒绝，且不触达引擎
    const before = stub.calls.read.length;
    const denied = await rest(base, { requester: 'B', projectId: 'A', tool: 'queryNeo4jGraph', args: { cypher: 'RETURN 1' } });
    check(denied.httpStatus === 403 && denied.json && denied.json.reason === 'not_authorized', 'THEN2 未授权默认拒绝 not_authorized');
    check(stub.calls.read.length === before, 'THEN2 未授权请求未触达引擎（授权在 120 判定）');

    // GIVEN A 授权 B
    check((await mcp(base, 'registry_authorize', { grantor: 'A', grantee: 'B', contentId: '*' })).status === 'ok', 'authorize A->B');

    // THEN 1: 授权后读取，tool/args 透传到引擎
    const ok = await rest(base, { requester: 'B', projectId: 'A', tool: 'queryNeo4jGraph', args: { cypher: 'MATCH (e) RETURN e' } });
    check(ok.httpStatus === 200 && ok.json.status === 'ok' && ok.json.tool === 'queryNeo4jGraph', 'THEN1 授权后读取 ok');
    const last = stub.calls.read[stub.calls.read.length - 1];
    check(last.tool === 'queryNeo4jGraph' && last.args && last.args.cypher === 'MATCH (e) RETURN e', 'THEN1 tool/args 透传给引擎');

    // THEN 3: 未知成员
    const unknown = await rest(base, { requester: 'B', projectId: 'zzz', tool: 'queryNeo4jGraph', args: {} });
    check(unknown.httpStatus === 403 && unknown.json.reason === 'member_not_found', 'THEN3 未知成员 member_not_found');

    // THEN 4: 非白名单工具（引擎拒绝）
    const bad = await rest(base, { requester: 'B', projectId: 'A', tool: 'applySystemArchitectureMutation', args: {} });
    check(bad.httpStatus === 400 && bad.json.reason && bad.json.reason.startsWith('tool_not_allowed'), 'THEN4 写工具被引擎拒绝 -> 400');

    // THEN 5: 注册自动建副本
    const beforeSync = stub.calls.sync.length;
    const regRes = await mcp(base, 'registry_register', { id: 'C', name: '项目 C', sourceRepo: '/tmp/c' });
    check(regRes.status === 'ok' && regRes.mirror && regRes.mirror.status === 'accepted', 'THEN5 注册返回 accepted（后台异步建副本）');
    await new Promise((r) => setTimeout(r, 400));
    check(stub.calls.sync.some((s) => s.projectId === 'C') && stub.calls.sync.length === beforeSync + 1, 'THEN5 注册后台触发引擎镜像同步');

    // THEN 6: 注销联动移除镜像
    const beforeRemove = stub.calls.remove.length;
    const dereg = await mcp(base, 'registry_deregister', { id: 'A' });
    check(dereg.status === 'ok' && stub.calls.remove.some((r) => r.projectId === 'A') && stub.calls.remove.length === beforeRemove + 1, 'THEN6 注销调用引擎移除镜像');
  } finally {
    child.kill();
    stub.server.close();
    await new Promise((resolve) => { let done = false; const f = () => { if (!done) { done = true; resolve(); } }; child.once('exit', f); setTimeout(f, 800); });
  }

  // THEN 7: 意图图结构登记
  if (!fs.existsSync(GRAPH_PATH)) { console.error(`FAIL: graph not found ${GRAPH_PATH}`); process.exit(1); }
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  const view = (graph.views || []).find((v) => v.view_id === 'cross-project-graph-query-view');
  check(!!view, 'THEN7 view cross-project-graph-query-view exists');
  if (view) {
    for (const id of ['mirror-host-service', 'external-graph-read-api', 'mirror-mcp-artifact']) {
      check((view.included_elements || []).includes(id), `THEN7 view includes ${id}`);
    }
    check(view.parent_element_id === 'kg-service-domain', 'THEN7 view mounted under kg-service-domain');
  }

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: 跨项目图谱查询（120 代理 + ARGO 镜像引擎）验收通过。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
