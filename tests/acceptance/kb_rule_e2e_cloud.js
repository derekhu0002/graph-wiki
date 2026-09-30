/**
 * Acceptance Test — 端到端云端验收规则 (E2E Cloud Acceptance Rule)
 *
 * 外部视角验收（External-view acceptance）：
 *
 * GIVEN canonical intent graph 位于 design/KG/SystemArchitecture.json
 * WHEN 在图中查找「端到端云端验收规则」Rule 元素
 * THEN
 *   1. 存在 type=Rule、id=kb-rule-e2e-cloud-acceptance 的元素
 *   2. 该元素被纳入「个人知识库规则」子视图（挂载在 kb-admin-actor 之下）
 *   3. 该元素带可执行验收用例（acceptanceCriteria 指向本脚本）
 */
const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');
const RULE_ID = 'kb-rule-e2e-cloud-acceptance';
const RULE_TYPE = 'Rule';
const RULES_VIEW_ID = 'kb-admin-rules';
const PARENT_ACTOR_ID = 'kb-admin-actor';

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(GRAPH_PATH)) {
    fail(`graph not found: ${GRAPH_PATH}`);
  }
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));

  // THEN 1: Rule 元素存在且类型正确
  const rule = (graph.elements || []).find((e) => e.id === RULE_ID);
  if (!rule) fail(`Rule element "${RULE_ID}" not found in graph`);
  if (rule.type !== RULE_TYPE) fail(`element "${RULE_ID}" type is "${rule.type}", expected "${RULE_TYPE}"`);

  // THEN 2: 纳入「个人知识库规则」子视图，且该视图挂载在 kb-admin-actor 之下
  const rulesView = (graph.views || []).find((v) => v.view_id === RULES_VIEW_ID);
  if (!rulesView) fail(`rules view "${RULES_VIEW_ID}" not found`);
  if (rulesView.parent_element_id !== PARENT_ACTOR_ID) {
    fail(`rules view "${RULES_VIEW_ID}" not mounted under actor "${PARENT_ACTOR_ID}"`);
  }
  if (!(rulesView.included_elements || []).includes(RULE_ID)) {
    fail(`rule "${RULE_ID}" not included in rules view "${RULES_VIEW_ID}"`);
  }

  // THEN 3: 带可执行验收用例
  const ac = (rule.testcases || []).map((t) => t.acceptanceCriteria).filter(Boolean);
  if (!ac.includes('tests/acceptance/kb_rule_e2e_cloud.js')) {
    fail(`rule "${RULE_ID}" has no executable acceptanceCriteria tests/acceptance/kb_rule_e2e_cloud.js`);
  }

  console.log(
    `PASS: Rule "${rule.name}" (${RULE_ID}) is registered in view "${RULES_VIEW_ID}" ` +
      `under actor "${PARENT_ACTOR_ID}" and carries an executable acceptance case.`
  );
}

main();
