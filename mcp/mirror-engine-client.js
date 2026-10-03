#!/usr/bin/env node
'use strict';
/**
 * HTTP client for the ARGO mirror-engine service (see mcp/mirror-engine-server.js),
 * which runs on the egress host holding Neo4j + the ARGO engine.
 *
 * The Graph Store (this service) keeps registry/grants and authorization; it only
 * delegates the heavy projection/query work to the engine over the private network.
 *
 * Env: MIRROR_ENGINE_URL (default http://172.18.2.191:18801).
 */
const DEFAULT_URL = 'http://172.18.2.191:18801';

function engineUrl() {
  return (process.env.MIRROR_ENGINE_URL || DEFAULT_URL).replace(/\/$/, '');
}

async function call(pathname, method, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
  try {
    const res = await fetch(engineUrl() + pathname, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { httpStatus: res.status, json };
  } catch (error) {
    return {
      httpStatus: 0,
      json: { status: 'unavailable', reason: 'engine_unreachable', error: String(error && error.message ? error.message : error) },
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  engineUrl,
  syncMirror: (body) => call('/mirror/sync', 'POST', body, 600000),
  readExternal: (body) => call('/graph/read', 'POST', body, 120000),
  removeMirror: (body) => call('/mirror/remove', 'POST', body, 60000),
  listMirrors: () => call('/mirrors', 'GET', null, 15000),
  getSchema: (body) => call('/schema', 'POST', body, 30000),
  getHealth: () => call('/health', 'GET', null, 10000),
};
