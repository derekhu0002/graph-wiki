#!/usr/bin/env node
'use strict';
/**
 * Mirror re-sync driver (runs on the Graph Store host).
 *
 * Reads the federation registry and asks the ARGO mirror-engine to sync every
 * active member that has a sourceRepo. The engine is idempotent by git commit,
 * so unchanged members are skipped; a new git/version triggers re-projection +
 * re-embedding. Intended to run from a systemd timer (periodic) or on demand.
 */
const fs = require('node:fs');
const path = require('node:path');
const registry = require('./registry.js');
const engineClient = require('./mirror-engine-client.js');

function resolveRepoRoot() {
  let dir = __dirname;
  while (true) {
    if (fs.existsSync(path.join(dir, 'assets', 'catalog.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
const REGISTRY_PATH = path.join(resolveRepoRoot(), 'assets', 'registry', 'registry.json');

(async () => {
  const reg = registry.load(REGISTRY_PATH);
  const members = (reg.members || []).filter((m) => m.status === 'active' && m.sourceRepo);
  console.log(`[sync-mirrors] engine=${engineClient.engineUrl()} members-with-repo=${members.length}`);
  for (const m of members) {
    const t = Date.now();
    try {
      const r = await engineClient.syncMirror({ projectId: m.id, sourceRepo: m.sourceRepo, branch: m.branch });
      console.log(`[sync-mirrors] ${m.id}: ${Date.now() - t}ms ${JSON.stringify(r.json).slice(0, 240)}`);
    } catch (e) {
      console.log(`[sync-mirrors] ${m.id} ERR: ${e && e.message ? e.message : e}`);
    }
  }
})();
