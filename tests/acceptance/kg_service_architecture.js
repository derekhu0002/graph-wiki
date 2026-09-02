/**
 * Acceptance Test - 总知识图谱服务架构 (Master Knowledge Graph Service)
 *
 * External-view acceptance:
 *
 * GIVEN canonical intent graph 位于 design/KG/SystemArchitecture.json
 * WHEN 在图中查找「总知识图谱服务」架构域及其服务化部署元素
 * THEN
 *   1. 存在 Grouping 类型、name=总知识图谱服务 的元素（架构域）
 *   2. 其下挂载子视图「总知识图谱服务架构」（parent_element_id 指向该 Grouping 的 View）
 *   3. 该子视图包含关键部署元素：总知识图谱远端服务(Application Service)、
 *      ARGO MCP HTTP/SSE 网关(Application Component)、总知识图谱(Data Object)、
 *      知识图谱服务器(Node)、Neo4j 投影与语义存储(System Software)
 *   4. 架构域被纳入顶层 SystemArchitecture 视图
 */
const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');
const DOMAIN_NAME = '总知识图谱服务';
const DOMAIN_TYPE = 'Grouping';
const SUB_VIEW_NAME = '总知识图谱服务架构';
const TOP_VIEW_NAME = 'SystemArchitecture';
const REQUIRED_ELEMENTS = [
  { name: '总知识图谱远端服务', type: 'Application Service' },
  { name: 'ARGO MCP HTTP/SSE 网关', type: 'Application Component' },
  { name: '总知识图谱', type: 'Data Object' },
  { name: '知识图谱服务器', type: 'Node' },
  { name: 'Neo4j 投影与语义存储', type: 'System Software' },
  { name: '知识消费/贡献项目', type: 'Business Actor' },
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(GRAPH_PATH)) {
    fail(`graph not found: ${GRAPH_PATH}`);
  }
  const graph = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));

  // THEN 1: 架构域 Grouping 存在
  const domain = (graph.elements || []).find(
    (e) => e.name === DOMAIN_NAME && e.type === DOMAIN_TYPE
  );
  if (!domain) {
    fail(`no ${DOMAIN_TYPE} named "${DOMAIN_NAME}" found in graph`);
  }

  // THEN 2: 子视图挂载在 Grouping 之下
  const subView = (graph.views || []).find(
    (v) => v.view_name === SUB_VIEW_NAME && v.parent_element_id === domain.id
  );
  if (!subView) {
    fail(`no sub-view "${SUB_VIEW_NAME}" mounted under "${DOMAIN_NAME}" (${domain.id})`);
  }

  // THEN 3: 子视图包含关键部署元素
  const elementById = new Map((graph.elements || []).map((e) => [e.id, e]));
  for (const req of REQUIRED_ELEMENTS) {
    const member = (subView.included_elements || [])
      .map((id) => elementById.get(id))
      .find((e) => e && e.name === req.name && e.type === req.type);
    if (!member) {
      fail(`sub-view "${SUB_VIEW_NAME}" is missing element "${req.name}" (${req.type})`);
    }
  }

  // THEN 4: 架构域纳入顶层 SystemArchitecture 视图
  const topView = (graph.views || []).find(
    (v) => v.view_name === TOP_VIEW_NAME && !v.parent_element_id
  );
  if (!topView) {
    fail(`top-level ${TOP_VIEW_NAME} view not found`);
  }
  if (!(topView.included_elements || []).includes(domain.id)) {
    fail(`domain "${DOMAIN_NAME}" (${domain.id}) not included in top-level ${TOP_VIEW_NAME} view`);
  }

  console.log(
    `PASS: ${DOMAIN_NAME} domain (${domain.id}) registered with sub-view ` +
      `"${SUB_VIEW_NAME}" (${subView.view_id}), containing ${REQUIRED_ELEMENTS.length} key ` +
      `deployment elements, and visible in the ${TOP_VIEW_NAME} view.`
  );
}

main();
