#!/usr/bin/env node
/**
 * 共享 ARCHGRAPH 图谱 schema 校验（纯 Node 零依赖，服务与验收测试共同复用）。
 *
 * 从 asset-mcp-server.js 抽出，保证「图谱资产入库」与「联邦副本托管」使用
 * 同一套结构级校验规则：结构必填字段 + 元素/关系类型合法性 + id 唯一 +
 * 关系端点引用存在 + view 成员引用存在 + 顶层视图唯一。
 */

const ARCH_ELEMENT_TYPES = [
  'Resource', 'Capability', 'Value Stream', 'Course of Action', 'Business Actor',
  'Business Role', 'Business Collaboration', 'Business Interface', 'Business Process',
  'Business Function', 'Business Interaction', 'Business Event', 'Business Service',
  'Business Object', 'Contract', 'Representation', 'Product', 'Application Component',
  'Application Collaboration', 'Application Interface', 'Application Process',
  'Application Function', 'Application Interaction', 'Application Event',
  'Application Service', 'Data Object', 'Node', 'Device', 'System Software',
  'Technology Collaboration', 'Technology Interface', 'Path', 'Communication Network',
  'Technology Process', 'Technology Function', 'Technology Interaction',
  'Technology Event', 'Technology Service', 'Artifact', 'Equipment', 'Facility',
  'Distribution Network', 'Material', 'Stakeholder', 'Driver', 'Assessment', 'Goal',
  'Outcome', 'Principle', 'Requirement', 'Constraint', 'Meaning', 'Value',
  'Work Package', 'Deliverable', 'Implementation Event', 'Plateau', 'Gap',
  'Grouping', 'Skill', 'Rule', 'Location', 'And Junction', 'Or Junction',
];

const ARCH_RELATIONSHIP_TYPES = [
  'Access', 'Aggregation', 'Assignment', 'Association', 'Composition', 'Flow',
  'Influence', 'Realization', 'Serving', 'Specialization', 'Triggering',
];

function validateGraph(graph) {
  const errors = [];
  if (!graph || typeof graph !== 'object') {
    return { valid: false, errors: ['graph must be an object'] };
  }
  for (const field of ['name', 'description']) {
    if (typeof graph[field] !== 'string' || graph[field].trim() === '') {
      errors.push(`graph.${field} is required (non-empty string)`);
    }
  }
  for (const field of ['elements', 'relationships', 'views']) {
    if (!Array.isArray(graph[field])) {
      errors.push(`graph.${field} must be an array`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  const elementIds = new Set();
  const seenIds = new Set();
  for (const e of graph.elements) {
    if (!e || typeof e !== 'object') { errors.push('element must be an object'); continue; }
    for (const f of ['id', 'name', 'type']) {
      if (typeof e[f] !== 'string' || e[f].trim() === '') errors.push(`element missing ${f}: ${e.name || '?'}`);
    }
    if (e.id && seenIds.has(e.id)) errors.push(`duplicate element id: ${e.id}`);
    if (e.id) seenIds.add(e.id);
    if (e.id) elementIds.add(e.id);
    if (e.type && !ARCH_ELEMENT_TYPES.includes(e.type)) {
      errors.push(`element "${e.name || e.id}" has invalid ArchiMate type "${e.type}"`);
    }
  }

  for (const r of graph.relationships) {
    if (!r || typeof r !== 'object') { errors.push('relationship must be an object'); continue; }
    for (const f of ['id', 'type', 'source_id', 'target_id', 'source_name', 'target_name', 'statement']) {
      if (typeof r[f] !== 'string' || r[f].trim() === '') errors.push(`relationship "${r.id || '?'}" missing ${f}`);
    }
    if (r.type && !ARCH_RELATIONSHIP_TYPES.includes(r.type)) {
      errors.push(`relationship "${r.id}" has invalid type "${r.type}"`);
    }
    if (r.source_id && !elementIds.has(r.source_id)) {
      errors.push(`relationship "${r.id}" source_id "${r.source_id}" does not reference an existing element`);
    }
    if (r.target_id && !elementIds.has(r.target_id)) {
      errors.push(`relationship "${r.id}" target_id "${r.target_id}" does not reference an existing element`);
    }
  }

  const viewIds = new Set();
  for (const v of graph.views) {
    if (!v || typeof v !== 'object') { errors.push('view must be an object'); continue; }
    if (typeof v.view_id !== 'string' || v.view_id.trim() === '') errors.push('view missing view_id');
    if (typeof v.view_name !== 'string' || v.view_name.trim() === '') errors.push(`view "${v.view_id || '?'}" missing view_name`);
    if (v.view_id) viewIds.add(v.view_id);
    for (const ref of (v.included_elements || [])) {
      if (!elementIds.has(ref)) errors.push(`view "${v.view_id}" references unknown element "${ref}"`);
    }
    if (v.parent_element_id && !elementIds.has(v.parent_element_id)) {
      errors.push(`view "${v.view_id}" parent_element_id "${v.parent_element_id}" does not reference an existing element`);
    }
  }

  const topViews = (graph.views || []).filter((v) => !v.parent_element_id);
  if (topViews.length > 1) {
    errors.push(`graph has ${topViews.length} top-level views; at most 1 allowed`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { ARCH_ELEMENT_TYPES, ARCH_RELATIONSHIP_TYPES, validateGraph };
