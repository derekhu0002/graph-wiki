/**
 * Acceptance Test - 跨项目图谱查询（外部图读取 + 副本托管）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 中心已登记成员 A、B，且 A 的图谱副本已托管/投影/向量化
 * WHEN 依次执行 未授权读取 → 授权 → 授权后读取 → 隔离校验 → 版本再同步 → 注销
 * THEN
 *   1. GIVEN A 未授权 B；WHEN B 读取 A；THEN 默认拒绝（not_authorized）
 *   2. GIVEN A 已授权 B；WHEN B 读取 A；THEN 返回 A 副本的查询结果与版本
 *   3. GIVEN 中心同时托管 A、B；WHEN 查 A；THEN 结果不含 B 的任何元素（命名空间隔离）
 *   4. GIVEN A 仓 push 新版本；WHEN 再同步；THEN 重新投影，查询返回新内容
 *   5. GIVEN A 已注销；WHEN 再查 A；THEN member_not_found 且副本被移除
 *   6. REST POST /graph/read 与 MCP 工具同源：未授权返回 denied / 授权返回 ok
 *   7. 意图图已登记「跨项目图谱查询」视图及关键元素
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const registry = require('../../mcp/registry.js');
const mirror = require('../../mcp/mirror.js');
const externalRead = require('../../mcp/external-read.js');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; }
}

function makeGraph(name, desc, elements) {
  return {
    name,
    description: desc,
    elements: elements.map((e) => ({ id: e.id, name: e.name, type: e.type, description: e.desc || '' })),
    relationships: [],
    views: [{ view_id: 'top', view_name: `${name} 顶层视图`, included_elements: elements.map((e) => e.id) }],
  };
}

function writeRepoGraph(repoDir, graph) {
  const file = path.join(repoDir, 'design', 'KG', 'SystemArchitecture.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(graph, null, 2) + '\n', 'utf8');
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { httpStatus: res.status, json };
}

async function waitHealth(base, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fed-mirror-'));
  const registryPath = path.join(assetRoot, 'registry', 'registry.json');
  const mirrorRoot = path.join(assetRoot, 'mirrors');

  const repoA = path.join(assetRoot, 'src-a');
  const repoB = path.join(assetRoot, 'src-b');

  const graphA1 = makeGraph('甲项目图谱', '甲项目（A）', [
    { id: 'a-core', name: 'A 核心服务', type: 'Application Service', desc: '甲项目核心服务，对外提供能力' },
  ]);
  const graphA2 = makeGraph('甲项目图谱 v2', '甲项目（A）', [
    { id: 'a-core', name: 'A 核心服务', type: 'Application Service', desc: '甲项目核心服务，对外提供能力' },
    { id: 'a-new', name: 'A 新增组件', type: 'Application Component', desc: '甲项目新增的组件' },
  ]);
  const graphB = makeGraph('乙项目图谱', '乙项目（B）', [
    { id: 'b-core', name: 'B 数据对象', type: 'Data Object', desc: '乙项目数据对象' },
  ]);
  writeRepoGraph(repoA, graphA1);
  writeRepoGraph(repoB, graphB);

  // GIVEN 成员 A、B 已注册（id 所有权：不同来源仓不可占用同一 id）
  let reg = registry.emptyRegistry();
  registry.registerMember(reg, { id: 'A', name: '甲项目', sourceRepo: repoA, openContent: [{ id: 'x', name: 'x', ref: 'ref' }] });
  registry.registerMember(reg, { id: 'B', name: '乙项目', sourceRepo: repoB });
  registry.save(registryPath, reg);

  let conflictThrew = false;
  try {
    registry.registerMember(registry.load(registryPath), { id: 'A', name: '入侵者', sourceRepo: path.join(assetRoot, 'evil') });
  } catch { conflictThrew = true; }
  check(conflictThrew, 'THEN0 失败: 同一 id 被不同来源仓注册时未拒绝（id 所有权缺失）');

  // GIVEN A 的副本已托管（投影 + 向量化）
  const syncA1 = mirror.sync(mirrorRoot, 'A', { sourceRepo: repoA, commit: 'c1' });
  check(syncA1.synced === true && syncA1.namespaceKey === 'proj:A', `THEN0 失败: A 副本未托管 ${JSON.stringify(syncA1)}`);
  check(mirror.sync(mirrorRoot, 'A', { sourceRepo: repoA, commit: 'c1' }).synced === false, 'THEN0 失败: 相同版本未幂等跳过');

  // THEN 1: 未授权默认拒绝
  const denied = externalRead.readExternal({ registryPath, mirrorRoot, requester: 'B', projectId: 'A', op: 'overview' });
  check(denied.status === 'denied' && denied.reason === 'not_authorized', `THEN1 失败: 未授权未默认拒绝 ${JSON.stringify(denied)}`);

  // GIVEN A 已授权 B
  reg = registry.load(registryPath);
  registry.authorize(reg, { grantor: 'A', grantee: 'B', contentId: '*' });
  registry.save(registryPath, reg);

  // THEN 2: 授权后读取返回副本查询结果 + 版本
  const ok = externalRead.readExternal({ registryPath, mirrorRoot, requester: 'B', projectId: 'A', op: 'elements' });
  check(ok.status === 'ok', `THEN2 失败: 已授权读取被拒 ${JSON.stringify(ok)}`);
  check(ok.version === 'c1' && ok.namespaceKey === 'proj:A', `THEN2 失败: 未返回版本/命名空间 ${JSON.stringify(ok)}`);
  check((ok.result.elements || []).some((e) => e.id === 'a-core'), `THEN2 失败: 未返回 A 的元素 ${JSON.stringify(ok.result)}`);

  const search = externalRead.readExternal({ registryPath, mirrorRoot, requester: 'B', projectId: 'A', op: 'search', text: '核心服务' });
  check(search.status === 'ok' && (search.result.results || []).some((r) => r.id === 'a-core'), `THEN2 失败: 向量化检索未命中 a-core ${JSON.stringify(search.result)}`);

  // GIVEN B 也已托管并被授权（隔离校验）
  mirror.sync(mirrorRoot, 'B', { sourceRepo: repoB, commit: 'b1' });
  reg = registry.load(registryPath);
  registry.authorize(reg, { grantor: 'B', grantee: 'A', contentId: '*' });
  registry.save(registryPath, reg);

  // THEN 3: 命名空间隔离——查 A 不含 B 元素，查 B 不含 A 元素
  const aElems = externalRead.readExternal({ registryPath, mirrorRoot, requester: 'B', projectId: 'A', op: 'elements' });
  const bElems = externalRead.readExternal({ registryPath, mirrorRoot, requester: 'A', projectId: 'B', op: 'elements' });
  const aIds = (aElems.result.elements || []).map((e) => e.id);
  const bIds = (bElems.result.elements || []).map((e) => e.id);
  check(aIds.every((id) => id.startsWith('a-')) && !aIds.includes('b-core'), `THEN3 失败: 查 A 泄漏 B 元素 ${aIds}`);
  check(bIds.every((id) => id.startsWith('b-')) && !bIds.includes('a-core'), `THEN3 失败: 查 B 泄漏 A 元素 ${bIds}`);

  // ---------- THEN 6: REST POST /graph/read（先于注销，复用当前已授权状态） ----------
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'asset-mcp-server.js')], {
    env: {
      ...process.env,
      ASSET_REPO_ROOT: assetRoot,
      ASSET_ROOT: assetRoot,
      ASSET_MCP_HOST: '127.0.0.1',
      ASSET_MCP_PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const healthy = await waitHealth(base, 25);
    check(healthy, 'THEN6 失败: REST 服务未就绪');
    if (healthy) {
      const restOk = await fetchJson(`${base}/graph/read`, { requester: 'B', projectId: 'A', op: 'overview' });
      check(restOk.httpStatus === 200 && restOk.json && restOk.json.status === 'ok', `THEN6 失败: 授权 REST 读取异常 ${JSON.stringify(restOk)}`);
      const restDenied = await fetchJson(`${base}/graph/read`, { requester: 'B', projectId: 'B', op: 'overview' });
      check(restDenied.httpStatus === 403 && restDenied.json && restDenied.json.status === 'denied', `THEN6 失败: 未授权 REST 未拒绝 ${JSON.stringify(restDenied)}`);
    }
  } finally {
    child.kill();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      child.once('exit', finish);
      setTimeout(finish, 800);
    });
  }

  // THEN 4: 版本再同步 → 重新投影
  writeRepoGraph(repoA, graphA2);
  const syncA2b = mirror.sync(mirrorRoot, 'A', { sourceRepo: repoA, commit: 'c2' });
  check(syncA2b.synced === true && syncA2b.reason === 'updated', `THEN4 失败: 新版本未重新投影 ${JSON.stringify(syncA2b)}`);
  const after = externalRead.readExternal({ registryPath, mirrorRoot, requester: 'B', projectId: 'A', op: 'elements' });
  check((after.result.elements || []).some((e) => e.id === 'a-new') && after.version === 'c2', `THEN4 失败: 新版本内容未生效 ${JSON.stringify(after.result)}`);

  // GIVEN A 已注销
  reg = registry.load(registryPath);
  registry.deregisterMember(reg, 'A');
  registry.save(registryPath, reg);
  mirror.remove(mirrorRoot, 'A');

  // THEN 5: 注销后 member_not_found 且副本移除
  const gone = externalRead.readExternal({ registryPath, mirrorRoot, requester: 'B', projectId: 'A', op: 'overview' });
  check(gone.status === 'denied' && gone.reason === 'member_not_found', `THEN5 失败: 注销后仍可查 ${JSON.stringify(gone)}`);
  check(mirror.exists(mirrorRoot, 'A') === false, 'THEN5 失败: 注销后副本未移除');

  // ---------- THEN 7: 意图图结构登记 ----------
  if (!fs.existsSync(GRAPH_PATH)) { console.error(`FAIL: 意图图不存在 ${GRAPH_PATH}`); process.exit(1); }
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  const view = (graph.views || []).find((v) => v.view_id === 'cross-project-graph-query-view');
  check(!!view, 'THEN7 失败: 意图图缺少 cross-project-graph-query-view 视图');
  if (view) {
    for (const id of ['mirror-host-service', 'external-graph-read-api', 'mirror-store', 'federation-rule-namespace-isolation']) {
      check((view.included_elements || []).includes(id), `THEN7 失败: 视图缺少关键元素 ${id}`);
    }
    check(view.parent_element_id === 'kg-service-domain', `THEN7 失败: 视图未挂载到 kg-service-domain（parent=${view.parent_element_id}）`);
  }

  if (failures > 0) {
    console.error(`\n共 ${failures} 项失败。`);
    process.exit(1);
  }
  console.log(
    'PASS: 跨项目图谱查询验收通过——未授权默认拒绝、授权后按 projectId 读托管副本、' +
      '命名空间隔离、版本再投影、注销清理、REST /graph/read 与意图图结构登记全部通过。'
  );
}

main().catch((e) => { console.error(`FAIL: 未捕获异常 ${e && e.stack ? e.stack : e}`); process.exit(1); });
