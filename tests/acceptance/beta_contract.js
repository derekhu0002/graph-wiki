/**
 * Acceptance Test - ArchGraph 0.27.0-beta.12 契约兼容（schema 响应形状 / 自动 slug id）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN beta 0.27 与 stable 0.26 两种 `queryNeo4jGraph {schema:true}` 原始返回 +
 *       含服务端自动分配 slug id 的上游图
 * WHEN 引擎 schema 适配器解析 / 中心结构校验
 * THEN
 *   1. 两种版本的 schema 响应（toolResult 信封 / structuredContent / 裸 payload）都能解析出枚举与元数据
 *   2. beta 形状的 schema 经中心校验：类型命中通过、类型不在枚举则拒绝（封闭 schema）
 *   3. 自动分配 slug id 的图（id 对中心不透明）在开放模式下通过结构校验
 *   4. 形状不可解析时明确失败（schema_unparsable 路径），不猜、不崩
 */
const { extractToolJson, extractSchemaEnums } = require('../../mcp/schema-adapt.js');
const { validateGraph } = require('../../mcp/graph-schema.js');

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

const BETA_PAYLOAD = {
  status: 'passed',
  architecturePath: 'design/KG/SystemArchitecture.json',
  graphKey: 'design/KG/SystemArchitecture.json',
  schema: {
    schemaKind: 'workspace',
    schemaLanguage: 'ArchiMate 3.2',
    archimateElementTypes: ['Capability', 'Business Actor', 'Application Component', 'billing-capability'],
    archimateRelationshipTypes: ['Association', 'Realization'],
    schemaDialect: 'archimate-class-matrix',
    actorElementType: 'Business Actor',
    bundleValidation: { status: 'passed', errors: [] },
    schemaPath: '.argo/schema/SystemArchitecture.schema.json',
    schemaDir: '.argo/schema',
    guidePath: '.argo/schema/GUIDE.md',
  },
  usage: { scopeGraph: 'MATCH (e:Element {graphKey: $graphKey}) ...' },
};

const STABLE_PAYLOAD = {
  status: 'passed',
  graphKey: 'design/KG/SystemArchitecture.json',
  schema: {
    schemaKind: 'default',
    schemaLanguage: 'ArchiMate 3.2',
    archimateElementTypes: ['Capability', 'Business Actor'],
    archimateRelationshipTypes: ['Association'],
  },
};

function graph(ids) {
  return {
    name: 'beta-contract-graph',
    description: 'fixture',
    elements: ids.map((id, i) => ({ id, name: `E${i}`, type: 'Capability' })),
    relationships: ids.length > 1
      ? [{ id: `${ids[0]}--rel`, type: 'Association', source_id: ids[0], target_id: ids[1], source_name: 'E0', target_name: 'E1', statement: 'E0 -> E1' }]
      : [],
    views: [{ view_id: 'v1', view_name: 'V1', included_elements: ids }],
  };
}

function main() {
  // THEN 1: beta toolResult envelope（content 文本 + structuredContent 并存）
  const betaRaw = { ...BETA_PAYLOAD, content: [{ type: 'text', text: JSON.stringify(BETA_PAYLOAD) }], structuredContent: BETA_PAYLOAD };
  const beta = extractSchemaEnums(betaRaw);
  check(!!beta && beta.elementTypes.length === 4 && beta.relationshipTypes.length === 2, 'THEN1 beta toolResult 信封可解析出枚举');
  check(beta.schemaKind === 'workspace' && beta.schemaLanguage === 'ArchiMate 3.2' && beta.guidePath === '.argo/schema/GUIDE.md', 'THEN1 beta schemaKind/language/guidePath 透传');
  check(beta.bundleValidation && beta.bundleValidation.status === 'passed', 'THEN1 beta bundleValidation 透传');

  // 裸 payload（无 content 信封）同样可解析
  check(!!extractSchemaEnums(BETA_PAYLOAD), 'THEN1 裸 payload 可解析');
  check(extractToolJson(betaRaw).status === 'passed', 'THEN1 extractToolJson 解包 content 文本');

  // THEN 1b: stable 0.26 形状
  const stableRaw = { ...STABLE_PAYLOAD, content: [{ type: 'text', text: JSON.stringify(STABLE_PAYLOAD) }] };
  const stable = extractSchemaEnums(stableRaw);
  check(!!stable && stable.elementTypes.length === 2 && stable.schemaKind === 'default', 'THEN1b stable 0.26 形状兼容');

  // THEN 2: beta 形状 schema 经中心校验
  const selfIds = ['billing-capability-001', 'billing-capability-002'];
  const closedBeta = { elementTypes: beta.elementTypes, relationshipTypes: beta.relationshipTypes, closed: true, source: 'engine' };
  const ok = validateGraph(graph(selfIds), closedBeta);
  check(ok.valid === true, 'THEN2 类型命中 beta 枚举：通过');
  const badGraph = graph(selfIds);
  badGraph.elements[0].type = 'NotInBundle';
  const bad = validateGraph(badGraph, closedBeta);
  check(bad.valid === false && bad.errors.some((e) => e.includes('NotInBundle')), 'THEN2 类型不在 beta 枚举：拒绝');

  // THEN 3: 自动 slug id（中心对 id 不透明）在开放模式通过结构校验
  const open = validateGraph(graph(['billing-capability-001', 'billing-capability-002']));
  check(open.valid === true, 'THEN3 自动 slug id 图在开放模式通过结构校验');

  // THEN 4: 不可解析形状明确失败
  check(extractSchemaEnums({ status: 'passed', schema: { noEnums: true } }) === null, 'THEN4 无枚举字段 → null（引擎将报 schema_unparsable）');
  check(extractSchemaEnums(null) === null, 'THEN4 空输入安全返回 null');

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: ArchGraph 0.27 beta 契约兼容验收通过。');
}

main();
