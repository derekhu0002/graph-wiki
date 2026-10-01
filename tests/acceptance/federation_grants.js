/**
 * Acceptance Test — 联邦授权关系列表 (registry_grants)
 *
 * 外部视角验收（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个含授权记录的 registry（A 授权 B，contentId=*）
 * WHEN 调用 registry.listGrants
 * THEN 返回该授权（grantor=A, grantee=B, contentId=*）
 *   且意图图已登记「联邦注册中心」视图与关键元素
 */
const fs = require('fs');
const path = require('path');
const registry = require('../../mcp/registry.js');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

function main() {
  const reg = registry.emptyRegistry();
  registry.registerMember(reg, { id: 'A', name: '项目 A', sourceRepo: '/tmp/a' });
  registry.registerMember(reg, { id: 'B', name: '项目 B', sourceRepo: '/tmp/b' });
  registry.authorize(reg, { grantor: 'A', grantee: 'B', contentId: '*' });
  registry.authorize(reg, { grantor: 'A', grantee: 'B', contentId: 'x-1' });

  const grants = registry.listGrants(reg);
  if (grants.length !== 2) fail(`期望 2 条授权，实际 ${grants.length}`);
  const star = grants.find((g) => g.contentId === '*');
  if (!star || star.grantor !== 'A' || star.grantee !== 'B') fail(`未返回 A->B 授权: ${JSON.stringify(grants)}`);
  if (!grants.some((g) => g.contentId === 'x-1')) fail('未返回按内容粒度的授权');

  if (!fs.existsSync(GRAPH_PATH)) fail(`意图图不存在 ${GRAPH_PATH}`);
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  const view = (graph.views || []).find((v) => v.view_id === 'federation-registry-view');
  if (!view) fail('意图图缺少 federation-registry-view 视图');
  if (!(view.included_elements || []).includes('federation-registry')) fail('视图缺少 federation-registry 元素');

  console.log('PASS: registry_grants 返回成员间授权关系（含内容范围），意图图登记完整。');
}

main();
