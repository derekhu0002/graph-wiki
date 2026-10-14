/**
 * Acceptance Test - 本体（schema bundle）资产上传接口
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个 Graph Store 服务（独立 temp 资产根）
 * WHEN 调用 ontology_submit / ontology_get / ontology_list / ontology_update
 * THEN
 *   1. GIVEN 合法 standalone bundle（schema 枚举 + config.actorElementType）；WHEN submit；THEN 接受并报类型计数
 *   2. GIVEN bundle 缺 actorElementType；WHEN submit；THEN bundle_validation_failed（fail-closed）
 *   3. GIVEN actorElementType 不在元素枚举内；WHEN submit；THEN 拒绝
 *   4. GIVEN standalone bundle 缺 SystemArchitecture.schema.json；WHEN submit；THEN 拒绝
 *   5. GIVEN extends bundle（仅 config）；WHEN submit；THEN 接受（kind=extends）
 *   6. GIVEN 非法 rules（非 JSON）；WHEN submit；THEN 拒绝
 *   7. GIVEN 已存在本体；WHEN ontology_get；THEN 返回完整 bundle 文件（schema/config）
 *   8. GIVEN ontology_list 与 graph_list；THEN 本体与图谱相互独立（不混目录、不混索引）
 *   9. GIVEN 已存在本体；WHEN ontology_update 部分文件（bump version + 新 rules）；THEN 接受且旧文件保留
 *  10. GIVEN 已存在 id；WHEN ontology_submit 同 id；THEN 报已存在（引导 update），不覆盖
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

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

function schemaDoc(elementTypes, relationshipTypes) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    $defs: {
      archimateElementType: { type: 'string', enum: elementTypes },
      archimateRelationshipType: { type: 'string', enum: relationshipTypes },
    },
  };
}
function bundle(opts = {}) {
  const b = {};
  if (opts.schema !== undefined) b['SystemArchitecture.schema.json'] = opts.schema;
  if (opts.config !== undefined) b['schema-bundle.config.json'] = opts.config;
  if (opts.rules !== undefined) b['schema-bundle.rules.json'] = opts.rules;
  if (opts.guide !== undefined) b['GUIDE.md'] = opts.guide;
  return b;
}

async function main() {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-assets-'));
  const port = 24000 + Math.floor(Math.random() * 12000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'asset-mcp-server.js')], {
    env: { ...process.env, ASSET_REPO_ROOT: assetRoot, ASSET_ROOT: assetRoot, ASSET_MCP_HOST: '127.0.0.1', ASSET_MCP_PORT: String(port), MIRROR_ENGINE_URL: 'http://127.0.0.1:1', GRAPH_STORE_LOG_DIR: path.join(assetRoot, 'logs') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    check(await waitHealth(base, 25), 'server ready');

    // THEN 1: 合法 standalone bundle → 接受
    const good = bundle({
      schema: schemaDoc(['Thing', 'Actor'], ['Links']),
      config: { id: 'demo-onto', actorElementType: 'Actor', language: 'Demo' },
      guide: '# Demo ontology',
    });
    const r1 = await mcp(base, 'ontology_submit', { id: 'demo-onto', name: 'Demo', version: '1.0.0', description: 'demo', bundle: good });
    check(r1.status === 'ok' && r1.validation && r1.validation.valid === true, 'THEN1 合法 standalone bundle 被接受');
    check(r1.validation.elementTypeCount === 2 && r1.validation.relationshipTypeCount === 1, 'THEN1 返回类型计数');
    check(fs.existsSync(path.join(assetRoot, 'ontologies', 'demo-onto', 'SystemArchitecture.schema.json')), 'THEN1 落盘到 assets/ontologies/<id>/');

    // THEN 2: 缺 actorElementType → 拒绝
    const noActor = bundle({ schema: schemaDoc(['Thing'], ['Links']), config: { id: 'x' } });
    const r2 = await mcp(base, 'ontology_submit', { id: 'no-actor', bundle: noActor });
    check(r2.status === 'failed' && r2.reason === 'bundle_validation_failed' && r2.errors.some((e) => e.includes('actorElementType')), 'THEN2 缺 actorElementType 被拒（fail-closed）');
    check(!fs.existsSync(path.join(assetRoot, 'ontologies', 'no-actor')), 'THEN2 拒绝时不落盘');

    // THEN 3: actorElementType 不在枚举 → 拒绝
    const badActor = bundle({ schema: schemaDoc(['Thing'], ['Links']), config: { actorElementType: 'Ghost' } });
    const r3 = await mcp(base, 'ontology_submit', { id: 'bad-actor', bundle: badActor });
    check(r3.status === 'failed' && r3.errors.some((e) => e.includes('not one of the declared element types')), 'THEN3 非法 actorElementType 被拒');

    // THEN 4: standalone 缺 schema 文件 → 拒绝
    const noSchema = bundle({ config: { actorElementType: null } });
    const r4 = await mcp(base, 'ontology_submit', { id: 'no-schema', bundle: noSchema });
    check(r4.status === 'failed' && r4.errors.some((e) => e.includes('requires SystemArchitecture.schema.json')), 'THEN4 缺 schema 文件被拒');

    // THEN 5: extends bundle（仅 config）→ 接受
    const ext = bundle({ config: { extends: 'default', id: 'my-ext', aliases: ['mine'] } });
    const r5 = await mcp(base, 'ontology_submit', { id: 'my-ext', bundle: ext });
    check(r5.status === 'ok' && r5.validation.kind === 'extends', 'THEN5 extends bundle 被接受（kind=extends）');

    // THEN 6: 非法 rules（非 JSON 字符串）→ 拒绝
    const badRules = bundle({ schema: schemaDoc(['Thing'], ['Links']), config: { actorElementType: null }, rules: '{not json' });
    const r6 = await mcp(base, 'ontology_submit', { id: 'bad-rules', bundle: badRules });
    check(r6.status === 'failed' && r6.errors.some((e) => e.includes('schema-bundle.rules.json')), 'THEN6 非法 rules 被拒');

    // THEN 7: ontology_get 返回完整 bundle
    const g7 = await mcp(base, 'ontology_get', { id: 'demo-onto' });
    check(g7.status === 'ok' && g7.files && g7.files['schema-bundle.config.json'] && g7.files['schema-bundle.config.json'].actorElementType === 'Actor', 'THEN7 ontology_get 返回完整 bundle');

    // THEN 8: 本体与图谱相互独立
    const list8 = await mcp(base, 'ontology_list', {});
    const graphs8 = await mcp(base, 'graph_list', {});
    check(list8.count === 2 && list8.ontologies.some((o) => o.id === 'demo-onto'), 'THEN8 ontology_list 含本体（2 个）');
    check(graphs8.count === 0, 'THEN8 graph_list 不含本体（两索引独立）');

    // THEN 9: 部分更新（bump version + 新 rules）→ 保留旧文件
    const r9 = await mcp(base, 'ontology_update', { id: 'demo-onto', version: '1.1.0', rules: { dialect: 'demo-matrix' } });
    check(r9.status === 'ok', 'THEN9 部分更新被接受');
    const g9 = await mcp(base, 'ontology_get', { id: 'demo-onto' });
    check(g9.asset.version === '1.1.0' && g9.files['schema-bundle.rules.json'] && g9.files['SystemArchitecture.schema.json'], 'THEN9 旧文件保留 + 新文件写入');

    // THEN 10: 重复 id → 报已存在，不覆盖
    const r10 = await mcp(base, 'ontology_submit', { id: 'demo-onto', bundle: good });
    check(r10.status === 'failed' && /已存在/.test(r10.error || ''), 'THEN10 重复 id 报已存在，引导 update');
  } finally {
    child.kill();
    await new Promise((resolve) => { let done = false; const f = () => { if (!done) { done = true; resolve(); } }; child.once('exit', f); setTimeout(f, 800); });
  }

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: 本体资产上传接口验收通过。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
