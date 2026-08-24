/**
 * Acceptance Test — 个人知识库管理员 (Personal Knowledge Base Administrator)
 *
 * 外部视角验收（External-view acceptance）：
 *
 * GIVEN canonical intent graph 位于 design/KG/SystemArchitecture.json
 * WHEN 在图中查找「个人知识库管理员」Business Actor 及其记忆挂载结构
 * THEN
 *   1. 存在一个 type=Business Actor、name=个人知识库管理员 的元素
 *   2. 其下挂载了长期记忆子视图（存在 parent_element_id 指向该 Actor 的 View）
 *   3. 该 Actor 被纳入顶层 SystemArchitecture 视图
 */
const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');
const ACTOR_NAME = '个人知识库管理员';
const ACTOR_TYPE = 'Business Actor';
const TOP_VIEW_NAME = 'SystemArchitecture';

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(GRAPH_PATH)) {
    fail(`graph not found: ${GRAPH_PATH}`);
  }
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));

  // THEN 1: Business Actor 存在
  const actors = (graph.elements || []).filter(
    (e) => e.name === ACTOR_NAME && e.type === ACTOR_TYPE
  );
  if (actors.length === 0) {
    fail(`no Business Actor named "${ACTOR_NAME}" found in graph`);
  }
  const actor = actors[0];

  // THEN 2: 长期记忆子视图挂载在 Actor 之下
  const memoryViews = (graph.views || []).filter(
    (v) => v.parent_element_id === actor.id
  );
  if (memoryViews.length === 0) {
    fail(`no long-term memory sub-view mounted under actor "${actor.id}"`);
  }

  // THEN 3: Actor 纳入顶层 SystemArchitecture 视图
  const topView = (graph.views || []).find(
    (v) => v.view_name === TOP_VIEW_NAME && !v.parent_element_id
  );
  if (!topView) {
    fail(`top-level ${TOP_VIEW_NAME} view not found`);
  }
  if (!(topView.included_elements || []).includes(actor.id)) {
    fail(`actor "${actor.id}" not included in top-level ${TOP_VIEW_NAME} view`);
  }

  console.log(
    `PASS: Business Actor "${ACTOR_NAME}" (${actor.id}) is registered with ` +
      `${memoryViews.length} memory sub-view(s) and visible in the ${TOP_VIEW_NAME} view.`
  );
}

main();
