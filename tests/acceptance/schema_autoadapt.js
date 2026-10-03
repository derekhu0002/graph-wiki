/**
 * Acceptance Test - Schema 自动适配（项目 schema 变化无须改中心代码）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个 stub 引擎（可按 projectId 返回框架解析的 schema）+ Graph Store 服务
 * WHEN 依次执行 graph_submit / graph_update（自述 schema / 框架 schema / 无 schema / 结构错误）
 * THEN
 *   1. GIVEN 图自带 schema（含自定义类型）；WHEN submit；THEN 接受（中心无内置类型清单）
 *   2. GIVEN 图声明封闭 schema 且类型不在其中；WHEN submit；THEN schema_validation_failed
 *   3. GIVEN 无 schema 声明、无 projectId（开放模式）；WHEN 自定义类型 submit；THEN 接受
 *   4. GIVEN 提供 projectId 且引擎返回该成员 schema；WHEN 类型命中 submit；THEN 接受；类型不在其中 THEN 拒绝
 *   5. GIVEN 引擎不可用/未同步；WHEN 提供 projectId；THEN 不阻塞（回退开放模式）且响应标注 schemaSource
 *   6. 开放模式下结构错误（关系引用不存在的元素）仍然拒绝（结构校验留在中心）
 *   7. GIVEN 已存在的图；WHEN graph_update 带封闭 schema 的非法类型；THEN 拒绝且不落盘
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

function startStub() {
  return new Promise((resolve) => {
    const calls = { schema: [] };
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const b = body ? JSON.parse(body) : {};
        const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
        if (req.method === 'POST' && req.url === '/schema') {
          calls.schema.push(b);
          if (b.projectId === 'P') return send(200, { status: 'ok', projectId: 'P', schema: { schemaKind: 'workspace', elementTypes: ['Widget'], relationshipTypes: ['Connects'], closed: true, source: 'engine' } });
          return send(403, { status: 'denied', reason: 'mirror_not_synced', projectId: b.projectId });
        }
        if (req.method === 'POST' && req.url === '/graph/read') return send(200, { status: 'ok', result: {} });
        if (req.method === 'GET' && req.url === '/mirrors') return send(200, { status: 'ok', count: 0, mirrors: [] });
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
async function waitHealth(base, attempts) {
  for (let i = 0; i < attempts; i += 1) { try { const r = await fetch(`${base}/health`); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

function makeGraph(elementType, relationshipType) {
  return {
    name: 'schema-test-graph',
    description: 'schema auto-adapt acceptance fixture',
    elements: [
      { id: 'e1', name: 'E1', type: elementType },
      { id: 'e2', name: 'E2', type: elementType },
    ],
    relationships: [
      { id: 'r1', type: relationshipType, source_id: 'e1', target_id: 'e2', source_name: 'E1', target_name: 'E2', statement: 'E1 -> E2' },
    ],
    views: [
      { view_id: 'v1', view_name: 'V1', included_elements: ['e1', 'e2'] },
    ],
  };
}

async function main() {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-adapt-'));
  const stub = await startStub();
  const port = 23000 + Math.floor(Math.random() * 12000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'asset-mcp-server.js')], {
    env: { ...process.env, ASSET_REPO_ROOT: assetRoot, ASSET_ROOT: assetRoot, ASSET_MCP_HOST: '127.0.0.1', ASSET_MCP_PORT: String(port), MIRROR_ENGINE_URL: `http://127.0.0.1:${stub.port}`, GRAPH_STORE_LOG_DIR: path.join(assetRoot, 'logs') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    check(await waitHealth(base, 25), 'server ready');

    // THEN 1: 图自带 schema（自定义类型）→ 接受
    const g1 = makeGraph('Widget', 'Connects');
    g1.schema = { elementTypes: ['Widget'], relationshipTypes: ['Connects'] };
    const r1 = await mcp(base, 'graph_submit', { id: 'declared-ok', graph: g1 });
    check(r1.status === 'ok' && r1.validation && r1.validation.valid === true, 'THEN1 自带 schema 的自定义类型被接受');
    check(r1.validation && r1.validation.schemaSource === 'declared', 'THEN1 响应对齐 schemaSource=declared');

    // THEN 2: 声明封闭 schema 且类型不在其中 → 拒绝
    const g2 = makeGraph('Alien', 'Connects');
    g2.schema = { elementTypes: ['Widget'], relationshipTypes: ['Connects'], closed: true };
    const r2 = await mcp(base, 'graph_submit', { id: 'declared-bad', graph: g2 });
    check(r2.status === 'failed' && r2.reason === 'schema_validation_failed', 'THEN2 封闭 schema 非法类型被拒绝');

    // THEN 3: 无 schema、无 projectId（开放模式）→ 接受
    const r3 = await mcp(base, 'graph_submit', { id: 'open-ok', graph: makeGraph('Alien', 'Teleports') });
    check(r3.status === 'ok' && r3.validation.schemaSource === 'open', 'THEN3 开放模式自定义类型被接受（无内置类型清单）');

    // THEN 4: projectId 解析框架 schema
    const r4ok = await mcp(base, 'graph_submit', { id: 'engine-ok', graph: makeGraph('Widget', 'Connects'), projectId: 'P' });
    check(r4ok.status === 'ok' && r4ok.validation.schemaSource === 'engine', 'THEN4 框架 schema 命中类型被接受（source=engine）');
    const r4bad = await mcp(base, 'graph_submit', { id: 'engine-bad', graph: makeGraph('Alien', 'Connects'), projectId: 'P' });
    check(r4bad.status === 'failed' && r4bad.reason === 'schema_validation_failed', 'THEN4 框架 schema 外类型被拒绝');

    // THEN 5: 引擎未同步/不可用 → 不阻塞（回退开放）
    const r5 = await mcp(base, 'graph_submit', { id: 'engine-missing', graph: makeGraph('Alien', 'Teleports'), projectId: 'Q' });
    check(r5.status === 'ok' && r5.validation.schemaSource === 'engine_unavailable', 'THEN5 引擎缺 schema 时不阻塞并标注 engine_unavailable');
    check(stub.calls.schema.some((c) => c.projectId === 'Q'), 'THEN5 确已向引擎查询 schema');

    // THEN 6: 开放模式下结构错误仍拒绝
    const broken = makeGraph('Alien', 'Teleports');
    broken.relationships[0].target_id = 'missing-element';
    const r6 = await mcp(base, 'graph_submit', { id: 'broken-open', graph: broken });
    check(r6.status === 'failed' && r6.errors.some((e) => e.includes('does not reference an existing element')), 'THEN6 开放模式结构错误仍被拒绝');

    // THEN 7: graph_update 同样走 schema 解析；非法类型拒绝且不落盘
    const r7 = await mcp(base, 'graph_update', { id: 'declared-ok', graph: makeGraph('Alien', 'Connects'), schema: { elementTypes: ['Widget'], relationshipTypes: ['Connects'] } });
    check(r7.status === 'failed' && r7.reason === 'schema_validation_failed', 'THEN7 graph_update 非法类型被拒绝');
    const get7 = await mcp(base, 'graph_get', { id: 'declared-ok' });
    check(get7 && get7.graph && get7.graph.name === 'schema-test-graph', 'THEN7 拒绝后资产未被破坏');
  } finally {
    child.kill();
    stub.server.close();
    await new Promise((resolve) => { let done = false; const f = () => { if (!done) { done = true; resolve(); } }; child.once('exit', f); setTimeout(f, 800); });
  }

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: schema 自动适配验收通过。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
