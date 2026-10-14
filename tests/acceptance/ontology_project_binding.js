/**
 * Acceptance Test - 项目 ↔ 本体 归属绑定（联邦成员声明所基于的本体）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个 Graph Store 服务（独立 temp 资产根）
 * WHEN 注册联邦成员（registry_register），并查询本体 ↔ 项目关联
 * THEN
 *   1. GIVEN 未声明 ontology；WHEN registry_register；THEN 拒绝（提交规范：必须声明所基于本体 id）
 *   2. GIVEN 货架上已有本体 demo-base；WHEN 成员 proj-a 声明 ontology=demo-base；THEN 接受，且不会新建占位（created=false）
 *   3. GIVEN 本体 ghost-onto 不在货架；WHEN 成员 proj-b 声明 ontology=ghost-onto；THEN 接受，并自动建「占位本体」（created=true）
 *   4. ontology_list：demo-base projectCount=1 非占位；ghost-onto 出现且 placeholder=true、projectCount=1
 *   5. ontology_get：demo-base.members 含 proj-a；ghost-onto.placeholder=true、files 为空、members 含 proj-b
 *   6. registry_discover：成员带上 ontology 字段
 *   7. 页面/客户端契约：federation.tsx 展示 ontology；ontology-detail.tsx 渲染关联项目；mcp.ts 暴露 ontology + ontologyGet.members
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FED_PAGE = path.join(REPO_ROOT, 'website', 'src', 'pages', 'federation.tsx');
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

const ONTO_BUNDLE = {
  'SystemArchitecture.schema.json': { $defs: { archimateElementType: { enum: ['Node'] }, archimateRelationshipType: { enum: ['Link'] } } },
  'schema-bundle.config.json': { id: 'demo-base', actorElementType: null, language: 'Demo Base' },
};

async function main() {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-binding-'));
  const port = 28000 + Math.floor(Math.random() * 8000);
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'mcp', 'asset-mcp-server.js')], {
    env: { ...process.env, ASSET_REPO_ROOT: assetRoot, ASSET_ROOT: assetRoot, ASSET_MCP_HOST: '127.0.0.1', ASSET_MCP_PORT: String(port), MIRROR_ENGINE_URL: 'http://127.0.0.1:1', GRAPH_STORE_LOG_DIR: path.join(assetRoot, 'logs') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    check(await waitHealth(base, 25), 'server ready');

    // THEN 1: 未声明 ontology → 拒绝
    const r1 = await mcp(base, 'registry_register', { id: 'no-onto' });
    check(r1.status === 'failed' && /ontology/.test(r1.error || ''), 'THEN1 未声明 ontology 被拒绝（提交规范）');

    // 货架上先放一个本体 demo-base
    const s = await mcp(base, 'ontology_submit', { id: 'demo-base', name: 'Demo Base', version: '1.0.0', bundle: ONTO_BUNDLE });
    check(s.status === 'ok', 'GIVEN 货架上已有本体 demo-base');

    // THEN 2: 声明货架上本体 → 接受，不建占位
    const r2 = await mcp(base, 'registry_register', { id: 'proj-a', name: 'Project A', ontology: 'demo-base', sourceRepo: 'https://example.com/a.git' });
    check(r2.status === 'ok' && r2.member.ontology === 'demo-base' && r2.ontology && r2.ontology.created === false, 'THEN2 货架本体：成员绑定成功且不新建占位');

    // THEN 3: 声明非货架本体 → 自动建占位
    const r3 = await mcp(base, 'registry_register', { id: 'proj-b', name: 'Project B', ontology: 'ghost-onto', sourceRepo: 'https://example.com/b.git' });
    check(r3.status === 'ok' && r3.ontology && r3.ontology.created === true, 'THEN3 非货架本体：自动建占位本体');

    // THEN 4: ontology_list 关联计数 + 占位标记
    const l = await mcp(base, 'ontology_list', {});
    const demo = (l.ontologies || []).find((o) => o.id === 'demo-base');
    const ghost = (l.ontologies || []).find((o) => o.id === 'ghost-onto');
    check(demo && demo.projectCount === 1 && demo.placeholder === false, 'THEN4 demo-base projectCount=1 非占位');
    check(ghost && ghost.placeholder === true && ghost.projectCount === 1, 'THEN4 ghost-onto 为占位且 projectCount=1');

    // THEN 5: ontology_get 关联项目
    const gd = await mcp(base, 'ontology_get', { id: 'demo-base' });
    check(gd.status === 'ok' && (gd.members || []).some((m) => m.id === 'proj-a'), 'THEN5 demo-base.members 含 proj-a');
    const gg = await mcp(base, 'ontology_get', { id: 'ghost-onto' });
    check(gg.status === 'ok' && gg.asset.placeholder === true && Object.keys(gg.files || {}).length === 0 && (gg.members || []).some((m) => m.id === 'proj-b'), 'THEN5 占位本体：files 为空、members 含 proj-b');

    // THEN 6: registry_discover 带 ontology
    const d = await mcp(base, 'registry_discover', {});
    const pa = (d.members || []).find((m) => m.id === 'proj-a');
    check(pa && pa.ontology === 'demo-base', 'THEN6 discover 成员带 ontology 字段');
  } finally {
    child.kill();
    await new Promise((resolve) => { let done = false; const f = () => { if (!done) { done = true; resolve(); } }; child.once('exit', f); setTimeout(f, 800); });
  }

  // ---------- 结构验收（页面/客户端契约） ----------
  const fedSrc = fs.readFileSync(FED_PAGE, 'utf8');
  const detailSrc = fs.readFileSync(DETAIL_PAGE, 'utf8');
  const libSrc = fs.readFileSync(MCP_LIB, 'utf8');
  check(/member\.ontology/.test(fedSrc) || /\.ontology/.test(fedSrc), 'THEN7 federation.tsx 展示成员 ontology');
  check(/members/.test(detailSrc) && /ontologyGet/.test(detailSrc), 'THEN7 ontology-detail.tsx 渲染关联项目');
  check(/ontology\b/.test(libSrc) && /FederationMember/.test(libSrc), 'THEN7 mcp.ts FederationMember 含 ontology');

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: 项目↔本体 归属绑定验收通过（强制声明 + 占位本体 + 关联列表）。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
