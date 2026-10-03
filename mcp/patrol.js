#!/usr/bin/env node
'use strict';
/**
 * Mirror patrol — turns the JSONL observability log into insights and (optional)
 * self-healing. Runs on the Graph Store host.
 *
 * Checks:
 *   1. engine health + ARGO version (framework-upgrade signal vs previous patrol)
 *   2. mirror health (ok/synced)
 *   3. schema compatibility smoke (framework report/schema shape via one healthy mirror)
 *   4. aggregated log anomalies: sync/semantic/schema failures, read denial rate
 *   5. upstream drift: member repo ahead of its mirror commit (when stale beyond threshold)
 *   6. with --heal: re-sync broken mirrors
 *
 * Env knobs:
 *   PATROL_WINDOW_MS (24h)  PATROL_DENY_RATE_WARN (0.5)  PATROL_MIN_READS (20)  PATROL_STALE_MS (2h)
 *   GRAPH_STORE_LOG_DIR  ASSET_ROOT  MIRROR_ENGINE_URL
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const registry = require('./registry.js');
const engineClient = require('./mirror-engine-client.js');
const obs = require('./obs.js');

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

const ASSET_ROOT = process.env.ASSET_ROOT || path.join(resolveRepoRoot(), 'assets');

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function lsRemote(sourceRepo, branch) {
  try {
    const out = execFileSync('git', ['ls-remote', sourceRepo, `refs/heads/${branch || 'main'}`], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = String(out).split('\n').map((l) => l.trim()).find(Boolean);
    return line ? line.split(/\s+/)[0] : null;
  } catch {
    return null;
  }
}

async function runPatrol(options = {}) {
  const startedAt = Date.now();
  const windowMs = num(options.windowMs, num(process.env.PATROL_WINDOW_MS, 24 * 3600e3));
  const denyRateWarn = num(options.denyRateWarn, num(process.env.PATROL_DENY_RATE_WARN, 0.5));
  const minReads = num(options.minReads, num(process.env.PATROL_MIN_READS, 20));
  const staleMs = num(options.staleMs, num(process.env.PATROL_STALE_MS, 2 * 3600e3));
  const since = startedAt - windowMs;
  const heal = options.heal !== undefined ? !!options.heal : process.argv.includes('--heal');
  const cli = options.engineClient || engineClient;
  const assetRoot = options.assetRoot || ASSET_ROOT;
  const registryPath = options.registryPath || path.join(assetRoot, 'registry', 'registry.json');
  const findings = [];

  let health = null;
  try { const r = await cli.getHealth(); health = r && r.json; } catch { health = null; }
  const engineUp = !!(health && health.status === 'ok');
  const argoVersion = (health && health.argoVersion) || null;
  if (!engineUp) findings.push({ level: 'error', code: 'engine_unreachable' });

  const prevPatrol = obs.latest('patrol', 'patrol');
  if (argoVersion && prevPatrol && prevPatrol.argoVersion && prevPatrol.argoVersion !== argoVersion) {
    findings.push({ level: 'warn', code: 'argo_version_changed', from: prevPatrol.argoVersion, to: argoVersion });
  }

  let mirrors = [];
  try { const r = await cli.listMirrors(); mirrors = (r && r.json && r.json.mirrors) || []; } catch { mirrors = []; }
  for (const m of mirrors) {
    if (!m.ok || !m.synced) findings.push({ level: 'error', code: 'mirror_not_ok', projectId: m.projectId });
  }

  const healthy = mirrors.find((m) => m.ok);
  if (engineUp && healthy) {
    try {
      const r = await cli.getSchema({ projectId: healthy.projectId });
      const s = r && r.json;
      if (!s || s.status !== 'ok' || !s.schema || !Array.isArray(s.schema.elementTypes) || s.schema.elementTypes.length === 0) {
        findings.push({ level: 'error', code: 'schema_compat_smoke_failed', projectId: healthy.projectId });
      }
    } catch (e) {
      findings.push({ level: 'warn', code: 'schema_compat_smoke_error', error: String((e && e.message) || e) });
    }
  }

  const engineEvents = obs.read('engine', { since, includeRotated: true });
  const storeEvents = obs.read('store', { since, includeRotated: true });

  const syncs = engineEvents.filter((e) => e.kind === 'sync');
  for (const e of syncs) {
    if (e.status !== 'ok') findings.push({ level: 'error', code: 'sync_failed', projectId: e.projectId, reason: e.reason });
    else if (e.semanticOk === false) findings.push({ level: 'error', code: 'semantic_failed', projectId: e.projectId });
  }
  for (const e of engineEvents.filter((e) => e.kind === 'schema' && e.status !== 'ok')) {
    findings.push({ level: 'warn', code: 'schema_failed', projectId: e.projectId, reason: e.reason });
  }

  const engineReads = engineEvents.filter((e) => e.kind === 'read');
  for (const e of engineReads) {
    if (e.status && e.status !== 'ok') {
      findings.push({ level: 'warn', code: 'read_failed', projectId: e.projectId, tool: e.tool, status: e.status, reason: e.reason });
    }
  }
  const storeReads = storeEvents.filter((e) => e.kind === 'graph_read');
  for (const e of storeReads) {
    if (e.reason === 'engine_unreachable') findings.push({ level: 'error', code: 'engine_unreachable_read', projectId: e.projectId, requester: e.requester });
  }
  const readTotal = engineReads.length + storeReads.length;
  const readDenied = engineReads.filter((e) => e.status === 'denied').length + storeReads.filter((e) => e.status === 'denied').length;
  if (readTotal >= minReads && readDenied / readTotal >= denyRateWarn) {
    findings.push({ level: 'warn', code: 'read_deny_rate_high', reads: readTotal, denied: readDenied });
  }

  let members = [];
  try { members = (registry.load(registryPath).members || []).filter((m) => m.status === 'active' && m.sourceRepo); } catch { members = []; }
  const byId = new Map(mirrors.map((m) => [m.projectId, m]));
  const now = Date.now();
  for (const m of members) {
    const mirror = byId.get(m.id);
    if (!mirror || !mirror.commit) continue;
    const age = mirror.syncedAt ? now - Date.parse(mirror.syncedAt) : Infinity;
    if (age < staleMs) continue;
    const upstream = lsRemote(m.sourceRepo, m.branch);
    if (upstream && upstream !== mirror.commit) {
      findings.push({ level: 'warn', code: 'mirror_drift', projectId: m.id, mirrorCommit: mirror.commit, upstreamCommit: upstream });
    }
  }

  const healed = [];
  if (heal && engineUp) {
    for (const m of mirrors.filter((x) => !x.ok || !x.synced)) {
      try {
        const r = await cli.syncMirror({ projectId: m.projectId });
        healed.push({ projectId: m.projectId, status: r && r.json && r.json.status, reason: r && r.json && r.json.reason });
      } catch (e) {
        healed.push({ projectId: m.projectId, status: 'error', error: String((e && e.message) || e) });
      }
    }
  }

  const status = !engineUp ? 'down' : (findings.length === 0 ? 'ok' : 'attention');
  const report = {
    status,
    engineUp,
    argoVersion,
    mirrors: mirrors.length,
    members: members.length,
    windowMs,
    reads: readTotal,
    denied: readDenied,
    syncs: syncs.length,
    findings,
    healed,
    durationMs: Date.now() - startedAt,
    checkedAt: new Date(startedAt).toISOString(),
  };
  obs.append('patrol', { kind: 'patrol', ...report });
  try {
    fs.mkdirSync(obs.logDir(), { recursive: true });
    fs.writeFileSync(path.join(obs.logDir(), 'patrol-latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch { /* best-effort */ }

  if (!options.silent) {
    console.log(`[patrol] status=${status} engine=${engineUp ? 'up' : 'down'} argo=${argoVersion || '?'} mirrors=${mirrors.length} findings=${findings.length}`);
    for (const f of findings) {
      console.log(`  - ${f.level} ${f.code}${f.projectId ? ` [${f.projectId}]` : ''}${f.reason ? ` ${f.reason}` : ''}`);
    }
    for (const h of healed) console.log(`  healed ${h.projectId}: ${h.status}${h.reason ? ` ${h.reason}` : ''}`);
  }
  return report;
}

module.exports = { runPatrol };

if (require.main === module) {
  runPatrol({ heal: process.argv.includes('--heal') })
    .then((r) => process.exit(r.status === 'ok' ? 0 : 1))
    .catch((e) => { console.error(`[patrol] FAILED: ${e && e.stack ? e.stack : e}`); process.exit(1); });
}
