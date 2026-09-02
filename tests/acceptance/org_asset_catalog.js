/**
 * Acceptance Test - AI 组织资产目录 (Organization Asset Catalog)
 *
 * External-view acceptance:
 *
 * GIVEN canonical intent graph 位于 design/KG/SystemArchitecture.json
 * WHEN 在图中查找「AI 组织资产目录」视图及其资产类型登记
 * THEN
 *   1. 存在「AI 组织资产目录」子视图，挂载在总知识图谱服务域（kg-service-domain）之下
 *   2. 视图包含 AGENT/SKILL/RULE/HOOKS/知识库 5 类资产登记元素
 *   3. 存在「知识消费/贡献项目」访问资产目录的关系（Access）
 *   4. 资产目录被总知识图谱承载（Association 关系）
 */
const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', '..', 'design', 'KG', 'SystemArchitecture.json');
const DOMAIN_ID = 'kg-service-domain';
const CATALOG_VIEW_NAME = 'AI 组织资产目录';
const CATALOG_ELEMENT_ID = 'org-asset-catalog';
const REQUIRED_ASSETS = [
  { id: 'org-asset-agent', name: 'AGENT 资产' },
  { id: 'org-asset-skill', name: 'SKILL 资产' },
  { id: 'org-asset-rule', name: 'RULE 资产' },
  { id: 'org-asset-hooks', name: 'HOOKS 资产' },
  { id: 'org-asset-knowledge', name: '知识库资产' },
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

  // THEN 1: 资产目录视图挂载在总知识图谱服务域之下
  const catalogView = (graph.views || []).find(
    (v) => v.view_name === CATALOG_VIEW_NAME && v.parent_element_id === DOMAIN_ID
  );
  if (!catalogView) {
    fail(`no sub-view "${CATALOG_VIEW_NAME}" mounted under domain "${DOMAIN_ID}"`);
  }

  // THEN 2: 视图包含 5 类资产登记元素 + 目录元素
  const elementById = new Map((graph.elements || []).map((e) => [e.id, e]));
  if (!(catalogView.included_elements || []).includes(CATALOG_ELEMENT_ID)) {
    fail(`catalog element "${CATALOG_ELEMENT_ID}" not in view`);
  }
  for (const asset of REQUIRED_ASSETS) {
    if (!(catalogView.included_elements || []).includes(asset.id)) {
      fail(`asset element "${asset.id}" (${asset.name}) not in catalog view`);
    }
    if (!elementById.has(asset.id)) {
      fail(`asset element "${asset.id}" missing from graph`);
    }
  }

  // THEN 3: 项目访问资产目录关系（Access）
  const accessRel = (graph.relationships || []).find(
    (r) => r.source_id === 'kg-consumer-actor' && r.target_id === CATALOG_ELEMENT_ID
  );
  if (!accessRel) {
    fail(`no Access relationship from 知识消费/贡献项目 to AI 组织资产目录`);
  }

  // THEN 4: 总知识图谱承载资产目录（Association）
  const graphRel = (graph.relationships || []).find(
    (r) => r.source_id === 'kg-master-graph' && r.target_id === CATALOG_ELEMENT_ID
  );
  if (!graphRel) {
    fail(`no Association relationship from 总知识图谱 to AI 组织资产目录`);
  }

  console.log(
    `PASS: AI 组织资产目录 view (${catalogView.view_id}) mounted under ${DOMAIN_ID}, ` +
      `registers ${REQUIRED_ASSETS.length} asset types, with Access (project) and ` +
      `Association (master graph) relationships.`
  );
}

main();
