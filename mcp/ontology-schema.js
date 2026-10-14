#!/usr/bin/env node
'use strict';
/**
 * ARCHGRAPH schema-bundle validation for ONTOLOGY assets.
 *
 * An ontology asset is a schema bundle (the type system + rules that define a
 * graph's vocabulary) — a DIFFERENT concept from a graph/subgraph (elements +
 * relationships + views). This validator reuses the ARGO schema-bundle contract
 * so a bundle accepted here is loadable by the framework at runtime:
 *
 *   <bundle>/SystemArchitecture.schema.json   the JSON-schema document whose
 *                                             `$defs.<elementTypeEnumKey>.enum`
 *                                             and `.$defs.<relationshipTypeEnumKey>.enum`
 *                                             carry the element/relationship types
 *   <bundle>/schema-bundle.config.json        descriptor: id/aliases/language,
 *                                             elementTypeEnumKey/relationshipTypeEnumKey,
 *                                             actorElementType, guide, rules, extends…
 *   <bundle>/schema-bundle.rules.json         optional ontology rules data (dialect…)
 *   <bundle>/GUIDE.md                         optional human guide
 *
 * Contract (fail-closed, matching the framework's bundleValidation):
 *   - A STANDALONE bundle (no `extends`) MUST ship SystemArchitecture.schema.json,
 *     a non-empty element/relationship type enum, and MUST declare `actorElementType`
 *     in schema-bundle.config.json (a valid element type, or null when the ontology
 *     genuinely has no actor concept). Missing => invalid.
 *   - An EXTENDS bundle (config.extends set) inherits the base vocabulary, so it
 *     needs the descriptor only; the center does not resolve the base here.
 *   - A present rules file must be a JSON object.
 *
 * Pure Node, zero dependencies (same rule as the rest of the Graph Store).
 */

const SCHEMA_BASENAME = 'SystemArchitecture.schema.json';
const CONFIG_BASENAME = 'schema-bundle.config.json';
const RULES_BASENAME = 'schema-bundle.rules.json';
const GUIDE_BASENAME = 'GUIDE.md';
const DEFAULT_ELEMENT_ENUM_KEY = 'archimateElementType';
const DEFAULT_RELATIONSHIP_ENUM_KEY = 'archimateRelationshipType';

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function enumFromSchema(schemaDoc, key) {
  const defs = schemaDoc && schemaDoc.$defs;
  const def = defs && defs[key];
  const values = def && Array.isArray(def.enum) ? def.enum : null;
  return values ? values.map(String) : null;
}

// Validate a schema bundle from its files (a filename -> content map; content is
// a parsed object or a raw JSON string, except GUIDE.md which is text).
function validateSchemaBundle(files) {
  const errors = [];
  const map = files || {};
  const config = asObject(map[CONFIG_BASENAME]) || {};
  const elementKey = typeof config.elementTypeEnumKey === 'string' && config.elementTypeEnumKey.trim()
    ? config.elementTypeEnumKey.trim() : DEFAULT_ELEMENT_ENUM_KEY;
  const relationshipKey = typeof config.relationshipTypeEnumKey === 'string' && config.relationshipTypeEnumKey.trim()
    ? config.relationshipTypeEnumKey.trim() : DEFAULT_RELATIONSHIP_ENUM_KEY;
  const extendsName = typeof config.extends === 'string' && config.extends.trim() ? config.extends.trim() : null;
  const standalone = !extendsName;

  let elementTypes = null;
  let relationshipTypes = null;

  if (standalone) {
    const schemaDoc = asObject(map[SCHEMA_BASENAME]);
    if (!schemaDoc) {
      errors.push(`standalone bundle requires ${SCHEMA_BASENAME} (a valid JSON object)`);
    } else {
      elementTypes = enumFromSchema(schemaDoc, elementKey);
      relationshipTypes = enumFromSchema(schemaDoc, relationshipKey);
      if (!elementTypes || elementTypes.length === 0) {
        errors.push(`${SCHEMA_BASENAME} is missing a non-empty $defs.${elementKey}.enum (element types)`);
      }
      if (!relationshipTypes || relationshipTypes.length === 0) {
        errors.push(`${SCHEMA_BASENAME} is missing a non-empty $defs.${relationshipKey}.enum (relationship types)`);
      }
      // Fail-closed: a standalone bundle must declare its actor contract.
      if (!Object.prototype.hasOwnProperty.call(config, 'actorElementType')) {
        errors.push(`${CONFIG_BASENAME} must declare "actorElementType" (an element type, or null when the ontology has no actor concept)`);
      } else if (config.actorElementType !== null && typeof config.actorElementType !== 'string') {
        errors.push('"actorElementType" must be a string element type or null');
      } else if (typeof config.actorElementType === 'string' && elementTypes
        && !elementTypes.includes(config.actorElementType)) {
        errors.push(`"actorElementType" ("${config.actorElementType}") is not one of the declared element types`);
      }
    }
  } else if (config.actorElementType !== undefined && config.actorElementType !== null
    && typeof config.actorElementType !== 'string') {
    errors.push('"actorElementType" must be a string element type or null');
  }

  if (map[CONFIG_BASENAME] !== undefined && !asObject(map[CONFIG_BASENAME])) {
    errors.push(`${CONFIG_BASENAME} must be a valid JSON object`);
  }

  const rules = map[RULES_BASENAME] === undefined ? null : asObject(map[RULES_BASENAME]);
  if (map[RULES_BASENAME] !== undefined && !rules) {
    errors.push(`${RULES_BASENAME} must be a valid JSON object`);
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      kind: standalone ? 'standalone' : 'extends',
      language: typeof config.language === 'string' ? config.language : null,
      extends: extendsName,
      id: typeof config.id === 'string' ? config.id : null,
      actorElementType: Object.prototype.hasOwnProperty.call(config, 'actorElementType') ? config.actorElementType : undefined,
      elementTypeCount: elementTypes ? elementTypes.length : null,
      relationshipTypeCount: relationshipTypes ? relationshipTypes.length : null,
      hasRules: !!rules,
      hasGuide: map[GUIDE_BASENAME] !== undefined,
    },
  };
}

module.exports = {
  SCHEMA_BASENAME,
  CONFIG_BASENAME,
  RULES_BASENAME,
  GUIDE_BASENAME,
  DEFAULT_ELEMENT_ENUM_KEY,
  DEFAULT_RELATIONSHIP_ENUM_KEY,
  validateSchemaBundle,
};
