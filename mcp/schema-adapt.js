#!/usr/bin/env node
'use strict';
/**
 * Schema-response adaptation shared by the mirror engine and its acceptance tests.
 *
 * Handles both the stable (0.26.x) and beta (0.27.x) shapes of ARGO's
 * `queryNeo4jGraph {schema:true}` result:
 *   - payload may arrive as `{...payload, content:[{text}]}` (toolResult envelope)
 *     or as a bare payload / `structuredContent`;
 *   - enum keys are `archimateElementTypes` / `archimateRelationshipTypes` (both
 *     versions unchanged), with `schemaKind` / `schemaLanguage` / `bundleValidation`
 *     / `guidePath` metadata carried through when present.
 */
function extractToolJson(result) {
  if (result && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
    try { return JSON.parse(result.content[0].text); } catch { return null; }
  }
  return result || null;
}

function extractSchemaEnums(raw) {
  const parsed = extractToolJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const schema = parsed.schema || parsed;
  if (!schema || typeof schema !== 'object') return null;
  const elementTypes = schema.archimateElementTypes || schema.elementTypes;
  if (!Array.isArray(elementTypes)) return null;
  const relationshipTypes = schema.archimateRelationshipTypes || schema.relationshipTypes;
  return {
    schemaKind: schema.schemaKind || null,
    schemaLanguage: schema.schemaLanguage || null,
    elementTypes: elementTypes.map(String),
    relationshipTypes: Array.isArray(relationshipTypes) ? relationshipTypes.map(String) : [],
    bundleValidation: schema.bundleValidation || null,
    guidePath: schema.guidePath || null,
  };
}

module.exports = { extractToolJson, extractSchemaEnums };
