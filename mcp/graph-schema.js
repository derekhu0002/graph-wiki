#!/usr/bin/env node
'use strict';
/**
 * Shared ARCHGRAPH graph-structure validation (service, acceptance tests, and
 * federation mirror hosting reuse the same rules).
 *
 * Schema-adaptive by design: type membership is enforced only when a schema is
 * available — declared by the graph itself (`graph.schema`) or resolved from the
 * framework (ARGO workspace schema). Without a schema the validator stays
 * structural, so a project schema change never requires a Graph Store code change.
 *
 * Structure checks always stay in the center: required fields, id uniqueness,
 * relationship endpoints, view member references, single top-level view.
 */

function pickArray(...candidates) {
  for (const c of candidates) {
    if (Array.isArray(c)) return c.map(String);
  }
  return null;
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return null;
  const elementTypes = pickArray(schema.elementTypes, schema.archimateElementTypes, schema.elements);
  const relationshipTypes = pickArray(schema.relationshipTypes, schema.archimateRelationshipTypes, schema.relationships);
  if (!elementTypes && !relationshipTypes) return null;
  return {
    elementTypes: elementTypes ? new Set(elementTypes) : null,
    relationshipTypes: relationshipTypes ? new Set(relationshipTypes) : null,
    closed: schema.closed !== false && schema.open !== true,
    source: String(schema.source || schema.schemaKind || 'declared'),
  };
}

function validateGraph(graph, schema) {
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

  const norm = normalizeSchema(schema || graph.schema);
  const closed = !!(norm && norm.closed);

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
    if (closed && norm.elementTypes && e.type && !norm.elementTypes.has(e.type)) {
      errors.push(`element "${e.name || e.id}" has type "${e.type}" not in ${norm.source} schema`);
    }
  }

  for (const r of graph.relationships) {
    if (!r || typeof r !== 'object') { errors.push('relationship must be an object'); continue; }
    for (const f of ['id', 'type', 'source_id', 'target_id', 'source_name', 'target_name', 'statement']) {
      if (typeof r[f] !== 'string' || r[f].trim() === '') errors.push(`relationship "${r.id || '?'}" missing ${f}`);
    }
    if (closed && norm.relationshipTypes && r.type && !norm.relationshipTypes.has(r.type)) {
      errors.push(`relationship "${r.id}" has type "${r.type}" not in ${norm.source} schema`);
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

module.exports = { normalizeSchema, validateGraph };
