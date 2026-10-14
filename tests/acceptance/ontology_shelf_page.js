/**
 * Acceptance Test - 本体货架页（社区站人类可见本体清单，货架实时同步）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个 Graph Store 服务（独立 temp 资产根）+ 社区站源码
 * WHEN 项目用 ontology_submit 提交本体后，货架数据源（ontology_list / ontology_get）被调用，
 *      且页面源码按其契约渲染
 * THEN
 *   1. ontology_list 返回已登记本体，字段满足货架渲染所需（id/name/version/description/bundle.elementTypeCount/actorElementType/language）
 *   2. 精确提交一个本体即计数+1（提交后刷新货架即可见——动态变化）
 *   3. ontology_get 返回该本体的完整 schema bundle 文件（schema/config）
 *   4. 页面源码：ontologies.tsx 调用 ontologyList，并以 /ontology-detail?id= 链接详情
 *   5. 客户端 mcp.ts 暴露 ontologyList / ontologyGet，分别经 ontology_list / ontology_get 拉取
 *   6. 详情页 ontology-detail.tsx 存在且调用 ontologyGet
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SHELF_PAGE = path.join(REPO_ROOT, 'website', 'src', 'pages', 'ontologies.tsx');
const DETAIL_PAGE = path.join(REPO_ROOT, 'website', 'src', 'pages', 'ontology-detail.tsx');
const MCP_LIB = path.join(REPO_ROOT, 'website', 'src', 'lib', 'mcp.ts');

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

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

function bundle(elements, relationships, actor) {
  return {
    'SystemArchitecture.schema.json': { $defs: { archimateElementType: { enum: elements }, archimateRelationshipType: { enum: relationships } } },
    'schema-bundle.config.json': { id: 'demo', actorElementType: actor, language: 'Demo' },
  };
}

async function main() {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-page-'));
  const port = 26000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'mcp', 'asset-mcp-server.js')], {
    env: { ...process.env, ASSET_REPO_ROOT: assetRoot, ASSET_ROOT: assetRoot, ASSET_MCP_HOST: '127.0.0.1', ASSET_MCP_PORT: String(port), MIRROR_ENGINE_URL: 'http://127.0.0.1:1', GRAPH_STORE_LOG_DIR: path.join(assetRoot, 'logs') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    check(await waitHealth(base, 25), 'server ready');

    const before = await mcp(base, 'ontology_list', {});
    const r = await mcp(base, 'ontology_submit', { id: 'demo-onto', name: 'Demo', version: '1.0.0', description: 'shelf fixture', bundle: bundle(['A', 'B'], ['R'], 'A') });
    check(r.status === 'ok', 'THEN2 提交本体成功');

    const after = await mcp(base, 'ontology_list', {});
    check(after.count === before.count + 1, 'THEN2 提交后货架计数 +1（动态变化）');

    const entry = (after.ontologies || []).find((o) => o.id === 'demo-onto');
    check(!!entry, 'THEN1 ontology_list 含新本体');
    check(entry.name === 'Demo' && entry.version === '1.0.0' && typeof entry.description === 'string', 'THEN1 元数据字段满足页面渲染');
    check(entry.bundle && entry.bundle.elementTypeCount === 2 && entry.bundle.relationshipTypeCount === 1 && entry.bundle.actorElementType === 'A' && entry.bundle.language === 'Demo', 'THEN1 bundle 概览字段（计数/actor/language）齐备');

    const g = await mcp(base, 'ontology_get', { id: 'demo-onto' });
    check(g.status === 'ok' && g.files && g.files['SystemArchitecture.schema.json'] && g.files['schema-bundle.config.json'], 'THEN3 ontology_get 返回完整 bundle');
  } finally {
    child.kill();
    await new Promise((resolve) => { let done = false; const f = () => { if (!done) { done = true; resolve(); } }; child.once('exit', f); setTimeout(f, 800); });
  }

  // ---------- 结构验收（页面契约） ----------
  for (const p of [SHELF_PAGE, DETAIL_PAGE, MCP_LIB]) check(fs.existsSync(p), `存在源码文件 ${path.basename(p)}`);
  const shelfSrc = fs.readFileSync(SHELF_PAGE, 'utf8');
  const detailSrc = fs.readFileSync(DETAIL_PAGE, 'utf8');
  const libSrc = fs.readFileSync(MCP_LIB, 'utf8');

  check(/ontologyList/.test(shelfSrc), 'THEN4 ontologies.tsx 调用 ontologyList');
  check(/\/ontology-detail\?id=/.test(shelfSrc), 'THEN4 ontologies.tsx 以 /ontology-detail?id= 链接详情');
  check(/ontologyList/.test(libSrc) && /ontology_list/.test(libSrc), 'THEN5 mcp.ts 暴露 ontologyList（调用 ontology_list）');
  check(/ontologyGet/.test(libSrc) && /ontology_get/.test(libSrc), 'THEN5 mcp.ts 暴露 ontologyGet（调用 ontology_get）');
  check(/ontologyGet/.test(detailSrc), 'THEN6 ontology-detail.tsx 调用 ontologyGet');

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: 本体货架页验收通过——提交后货架动态可见，页面/客户端契约一致。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
