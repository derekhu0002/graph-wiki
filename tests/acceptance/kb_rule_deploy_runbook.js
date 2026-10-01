/**
 * Acceptance Test — 部署与迁移运行规则 (Deploy/Runbook Rule)
 *
 * 外部视角验收（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN canonical intent graph 位于 design/KG/SystemArchitecture.json
 * WHEN 在图中查找「部署与迁移运行规则」Rule 元素
 * THEN
 *   1. 存在 type=Rule、id=kb-rule-deploy-runbook 的元素
 *   2. 被纳入「个人知识库规则」子视图（挂载 kb-admin-actor 之下）
 *   3. acceptanceCriteria 指向 tests/acceptance/kb_rule_deploy_runbook.js
 */
const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');
const RULE_ID = 'kb-rule-deploy-runbook';
const RULES_VIEW_ID = 'kb-admin-rules';
const PARENT_ACTOR_ID = 'kb-admin-actor';

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

function main() {
  if (!fs.existsSync(GRAPH_PATH)) fail(`graph not found: ${GRAPH_PATH}`);
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));

  const rule = (graph.elements || []).find((e) => e.id === RULE_ID);
  if (!rule) fail(`Rule ${RULE_ID} not found`);
  if (rule.type !== 'Rule') fail(`${RULE_ID} type is ${rule.type}, expected Rule`);

  const view = (graph.views || []).find((v) => v.view_id === RULES_VIEW_ID);
  if (!view) fail(`view ${RULES_VIEW_ID} not found`);
  if (view.parent_element_id !== PARENT_ACTOR_ID) fail(`view not mounted under ${PARENT_ACTOR_ID}`);
  if (!(view.included_elements || []).includes(RULE_ID)) fail(`${RULE_ID} not in ${RULES_VIEW_ID}`);

  const ac = (rule.testcases || []).map((t) => t.acceptanceCriteria).filter(Boolean);
  if (!ac.includes('tests/acceptance/kb_rule_deploy_runbook.js')) fail(`${RULE_ID} missing executable acceptanceCriteria`);

  console.log(`PASS: Rule ${RULE_ID} registered in ${RULES_VIEW_ID} with executable acceptance.`);
}

main();
