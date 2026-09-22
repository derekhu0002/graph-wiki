/**
 * Acceptance Test - 联邦注册中心 Registry（P0 只读）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 联邦注册中心 Registry 已就绪（registry.js 模块 + 意图图已登记联邦中心视图）
 * WHEN 依次执行 成员注册 → 发现 → 未授权读取 → 授权 → 授权后读取 → 注销 → 再发现
 * THEN
 *   1. GIVEN 成员已注册；WHEN 他人 discover；THEN 可见其基础信息
 *   2. GIVEN 成员未授权请求方；WHEN 请求方读取其内容；THEN 被拒绝（默认拒绝）
 *   3. GIVEN 成员已授权请求方；WHEN 请求方读取；THEN 获得其开放内容（引用，非副本）
 *   4. GIVEN 成员已注销；WHEN discover；THEN 不再可见
 *   5. 意图图 design/KG/SystemArchitecture.json 已登记「联邦注册中心」视图及关键元素
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const registry = require('../../mcp/registry.js');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function tmpRegistryPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fed-reg-'));
  return path.join(dir, 'registry.json');
}

function main() {
  // ---------- 行为验收（临时 registry，不污染真实资产库） ----------
  const registryPath = tmpRegistryPath();
  let reg = registry.emptyRegistry();

  const memberA = {
    id: 'archgraph',
    name: 'archgraph 框架项目',
    role: '规则 + MCP 接口',
    capabilities: ['ARGO 工具链', '意图图治理'],
    openContent: [
      { id: 'archgraph-argo-governance-001', name: 'ARGO 治理子图', ref: 'graph://archgraph-argo-governance-001' },
    ],
  };
  const memberB = {
    id: 'aBot',
    name: 'aBot 项目',
    role: '项目总管 / 人形机器人研发',
    capabilities: ['长期记忆维护', '多角色协调委派'],
    openContent: [
      { id: 'abot-overseer-capability-001', name: '项目总管能力子图', ref: 'graph://abot-overseer-capability-001' },
    ],
  };

  // GIVEN 成员已注册
  registry.registerMember(reg, memberA);
  registry.registerMember(reg, memberB);
  registry.save(registryPath, reg);
  reg = registry.load(registryPath);

  // THEN 1: discover 可见基础信息
  let discovered = registry.discover(reg);
  const seenIds = discovered.map((m) => m.id);
  if (!seenIds.includes('archgraph') || !seenIds.includes('aBot')) {
    fail(`THEN1 失败: discover 未返回已注册成员 ${seenIds.join(',')}`);
  }
  const archMember = discovered.find((m) => m.id === 'archgraph');
  if (
    archMember.name !== 'archgraph 框架项目' ||
    !archMember.capabilities.includes('ARGO 工具链')
  ) {
    fail(`THEN1 失败: 成员基础信息不完整 ${JSON.stringify(archMember)}`);
  }

  // THEN 2: 未授权默认拒绝
  const denied = registry.readAuthorized(reg, { requester: 'aBot', member: 'archgraph' });
  if (denied.status !== 'denied') {
    fail(`THEN2 失败: 未授权读取未默认拒绝 ${JSON.stringify(denied)}`);
  }

  // GIVEN 成员已授权请求方
  registry.authorize(reg, { grantor: 'archgraph', grantee: 'aBot', contentId: '*' });
  registry.save(registryPath, reg);
  reg = registry.load(registryPath);

  // THEN 3: 授权后读取获得开放内容（引用）
  const allowed = registry.readAuthorized(reg, { requester: 'aBot', member: 'archgraph' });
  if (allowed.status !== 'ok') {
    fail(`THEN3 失败: 已授权读取被拒绝 ${JSON.stringify(allowed)}`);
  }
  if (!allowed.content.some((c) => c.id === 'archgraph-argo-governance-001')) {
    fail(`THEN3 失败: 未获得开放内容 ${JSON.stringify(allowed.content)}`);
  }
  if (allowed.content.some((c) => typeof c.ref !== 'string' || c.ref === '')) {
    fail(`THEN3 失败: 开放内容应为引用而非副本 ${JSON.stringify(allowed.content)}`);
  }

  // GIVEN 成员已注销
  registry.deregisterMember(reg, 'archgraph');
  registry.save(registryPath, reg);
  reg = registry.load(registryPath);

  // THEN 4: 注销后 discover 不再可见
  discovered = registry.discover(reg);
  if (discovered.some((m) => m.id === 'archgraph')) {
    fail(`THEN4 失败: 已注销成员仍可见 ${JSON.stringify(discovered.map((m) => m.id))}`);
  }
  if (!discovered.some((m) => m.id === 'aBot')) {
    fail('THEN4 失败: 未注销成员 aBot 也不可见');
  }

  // ---------- 结构验收（意图图已登记联邦中心视图） ----------
  if (!fs.existsSync(GRAPH_PATH)) fail(`THEN5 失败: 意图图不存在 ${GRAPH_PATH}`);
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));

  const view = (graph.views || []).find((v) => v.view_id === 'federation-registry-view');
  if (!view) fail('THEN5 失败: 意图图缺少 federation-registry-view 视图');
  const viewMembers = view.included_elements || [];
  for (const requiredId of ['federation-registry', 'federation-registry-data', 'federation-member']) {
    if (!viewMembers.includes(requiredId)) {
      fail(`THEN5 失败: 视图缺少关键元素 ${requiredId}`);
    }
  }

  console.log(
    `PASS: 联邦注册中心 P0（注册/发现/默认拒绝/授权/授权后读取/注销）4 条行为验收 + ` +
      `意图图结构登记验收全部通过（discover 现可见成员: ${discovered.map((m) => m.id).join(', ') || '(空)'}）。`
  );
}

main();
