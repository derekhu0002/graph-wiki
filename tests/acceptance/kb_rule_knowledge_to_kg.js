/**
 * Acceptance Test — 知识写入 KG 规则 (Knowledge-to-KG Rule)
 *
 * 外部视角验收（External-view acceptance）：
 *
 * GIVEN canonical intent graph 位于 design/KG/SystemArchitecture.json
 * WHEN 在图中查找「知识写入 KG 规则」Rule 元素
 * THEN
 *   1. 存在一个 type=Rule、name=知识写入 KG 规则 的元素
 *   2. 该元素被纳入「个人知识库规则」子视图（view 挂载在 kb-admin-actor 之下）
 */
const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');
const RULE_NAME = '知识写入 KG 规则';
const RULE_TYPE = 'Rule';
const RULE_ID = 'kb-rule-knowledge-to-kg';
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
  const rules = (graph.elements || []).filter(
    (e) => e.id === RULE_ID && e.name === RULE_NAME && e.type === RULE_TYPE
  );
  if (rules.length === 0) {
    fail(`no Rule element "${RULE_NAME}" (${RULE_ID}) found in graph`);
  }

  // THEN 2: 纳入「个人知识库规则」子视图，且该视图挂载在 kb-admin-actor 之下
  const rulesView = (graph.views || []).find((v) => v.view_id === RULES_VIEW_ID);
  if (!rulesView) {
    fail(`rules view "${RULES_VIEW_ID}" not found`);
  }
  if (rulesView.parent_element_id !== PARENT_ACTOR_ID) {
    fail(`rules view "${RULES_VIEW_ID}" not mounted under actor "${PARENT_ACTOR_ID}"`);
  }
  if (!(rulesView.included_elements || []).includes(RULE_ID)) {
    fail(`rule "${RULE_ID}" not included in rules view "${RULES_VIEW_ID}"`);
  }

  console.log(
    `PASS: Rule "${RULE_NAME}" (${RULE_ID}) is registered and visible in ` +
      `view "${RULES_VIEW_ID}" mounted under actor "${PARENT_ACTOR_ID}".`
  );
}

main();
