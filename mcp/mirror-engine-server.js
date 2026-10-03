#!/usr/bin/env node
'use strict';
/**
 * ARGO Mirror Engine Service
 *
 * Runs on the mirror host (the egress-capable machine that holds Neo4j + the ARGO
 * engine), e.g. 47.107.161.168. It does NOT reimplement any query semantics: it
 * reuses the deployed ARGO engine to
 *   1. project a member's graph into Neo4j + run the semantic lifecycle (Qwen
 *      embedding) via ensureArgoHarnessEnvironment.buildHarnessReport, and
 *   2. serve read queries via systemarchitecture-mcp-server.callTool.
 *
 * Isolation: each member gets its own workspace directory (<MIRRORS_ROOT>/<projectId>)
 * and, because ARGO derives the Neo4j database name from the workspace root, its
 * own database (<projectId>) — exactly like a local project. Reads/writes pass a
 * per-call `workspaceRoot`, so concurrent calls for different members are safe
 * (no process-global env mutation).
 *
 * Authorization is enforced UPSTREAM by the Graph Store; this service is an
 * internal, read-mostly worker.
 *
 * Env:
 *   ARGO_ROOT            default <HOME>/.argo
 *   MIRRORS_ROOT         default <HOME>/mirrors
 *   MIRROR_ENGINE_HOST   default 0.0.0.0
 *   MIRROR_ENGINE_PORT   default 18801
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const obs = require('./obs.js');

const HOME = process.env.HOME || '/root';
const ARGO_ROOT = process.env.ARGO_ROOT || path.join(HOME, '.argo');
const MIRRORS_ROOT = process.env.MIRRORS_ROOT || path.join(HOME, 'mirrors');
const HOST = process.env.MIRROR_ENGINE_HOST || '0.0.0.0';
const PORT = Number(process.env.MIRROR_ENGINE_PORT || 18801);
const DEFAULT_GRAPH_PATH = 'design/KG/SystemArchitecture.json';
const READ_TOOLS = new Set([
  'getSystemArchitecture',
  'getIntentElementContext',
  'getArchitectureViewContext',
  'queryNeo4jGraph',
  'memory_search',
]);

// Load the approved external config from ~/.argo/.env (the engine reads process.env).
function loadEnv() {
  const envPath = path.join(ARGO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    if (key && process.env[key] === undefined) process.env[key] = line.slice(i + 1).trim();
  }
}
loadEnv();
// Isolation is per-member database (derived from workspaceRoot); never pin a global DB.
delete process.env.ARGO_NEO4J_DATABASE;

let _argoVersionCache;
function argoVersion() {
  if (_argoVersionCache !== undefined) return _argoVersionCache;
  const readVersion = (p) => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).version || null; } catch { return null; }
  };
  let v = process.env.ARGO_VERSION || readVersion(path.join(ARGO_ROOT, 'package.json'));
  if (!v) {
    const sibling = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'archgraph-argo', 'package.json');
    v = readVersion(sibling);
  }
  if (!v) {
    try {
      const prefix = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      v = readVersion(path.join(prefix, 'archgraph-argo', 'package.json'));
    } catch { v = null; }
  }
  _argoVersionCache = v || null;
  return _argoVersionCache;
}

let _engine = null;
function engine() {
  if (!_engine) {
    _engine = {
      mcp: require(path.join(ARGO_ROOT, 'scripts', 'systemarchitecture-mcp-server.js')),
      harness: require(path.join(ARGO_ROOT, 'scripts', 'ensureArgoHarnessEnvironment.js')),
      store: require(path.join(ARGO_ROOT, 'scripts', 'neo4j-system-architecture-store.js')),
    };
  }
  return _engine;
}

function safeId(projectId) {
  const id = String(projectId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`invalid projectId: ${projectId}`);
  return id;
}
function workdir(projectId) {
  return path.join(MIRRORS_ROOT, safeId(projectId));
}
function metaPath(projectId) {
  return path.join(MIRRORS_ROOT, '.meta', `${safeId(projectId)}.json`);
}
function readMeta(projectId) {
  try { return JSON.parse(fs.readFileSync(metaPath(projectId), 'utf8')); } catch { return null; }
}
function writeMeta(projectId, meta) {
  const p = metaPath(projectId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}
function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

// Async git that does NOT block the event loop. Network ops force HTTP/1.1:
// git/curl's default HTTP/2 to github.com intermittently fails with
// "Error in the HTTP2 framing layer", which is fatal for fresh clones.
function gitAsync(args, cwd) {
  return execFileAsync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .then((r) => r.stdout.trim());
}

// Concurrency limiter: keep at most MAX_CONCURRENT_SYNCS syncs in flight so a
// burst of registrations can never saturate the single-threaded engine and
// starve /mirrors or /health (which surfaced as engine_unreachable).
let _activeSyncs = 0;
const MAX_CONCURRENT_SYNCS = 2;
const _syncQueue = [];
function runSync(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      _activeSyncs++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        _activeSyncs--;
        const next = _syncQueue.shift();
        if (next) next();
      });
    };
    if (_activeSyncs < MAX_CONCURRENT_SYNCS) start();
    else _syncQueue.push(start);
  });
}

async function dbExists(projectId) {
  try {
    const { store } = engine();
    const config = store.getNeo4jConfig({ database: 'system' });
    const driver = store.createDriver(config);
    const session = driver.session({ database: 'system' });
    const r = await session.run('SHOW DATABASES YIELD name WHERE name = $n RETURN name', { n: projectId });
    const exists = r.records.length > 0;
    await session.close();
    await driver.close();
    return exists;
  } catch { return false; }
}

async function cloneWithRetry(dir, sourceRepo, branchName) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await gitAsync(['-c', 'http.version=HTTP/1.1', 'clone', '--depth', '1', '--branch', branchName, sourceRepo, '.'], dir);
      return;
    } catch (e) {
      lastErr = e;
      // Drop any half-written clone so the next attempt starts clean.
      try { fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true }); } catch {}
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

async function fetchRepo(projectId, sourceRepo, branch) {
  const dir = workdir(projectId);
  const branchName = branch || 'main';
  if (!sourceRepo) return dir;
  const netCfg = ['-c', 'http.version=HTTP/1.1'];
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    await cloneWithRetry(dir, sourceRepo, branchName);
  } else {
    // Transient network failure must not break an already-built mirror: keep the
    // existing checkout and let the caller's commit check decide re-projection.
    try {
      await gitAsync([...netCfg, 'fetch', '--depth', '1', 'origin', branchName], dir);
      await gitAsync(['reset', '--hard', `origin/${branchName}`], dir);
    } catch { /* keep current checkout */ }
  }
  return dir;
}

async function sync(input) {
  const startedAt = Date.now();
  const result = await syncInner(input);
  obs.append('engine', {
    kind: 'sync',
    projectId: input && input.projectId,
    branch: (input && input.branch) || 'main',
    status: result.status,
    synced: !!result.synced,
    reason: result.reason,
    commit: result.commit || null,
    neo4jOk: result.neo4j ? result.neo4j.status === 'ok' : result.neo4jOk === true,
    semanticOk: result.semanticLifecycle ? !!result.semanticLifecycle.ok : result.semanticOk === true,
    durationMs: Date.now() - startedAt,
    argoVersion: argoVersion(),
  });
  return result;
}

async function syncInner(input) {
  const projectId = safeId(input.projectId);
  const dir = await fetchRepo(projectId, input.sourceRepo, input.branch);
  const graphAbs = path.join(dir, DEFAULT_GRAPH_PATH);
  if (!fs.existsSync(graphAbs)) return { status: 'failed', reason: 'graph_not_found', projectId, graphAbs };
  let commit = null;
  try { commit = git(['rev-parse', 'HEAD'], dir); } catch { /* not a git dir */ }

  // Idempotent by git version — but only if the projection actually exists.
  // 同步时的幂等不能只看 meta.ok：必须确认该成员的 Neo4j 库确实存在，否则重建（自愈）。
  const meta = readMeta(projectId);
  if (meta && commit && meta.commit === commit && meta.ok) {
    if (await dbExists(projectId)) {
      return { status: 'ok', synced: false, reason: 'up-to-date', projectId, workspaceRoot: dir, namespaceKey: `proj:${projectId}`, commit };
    }
    // DB 缺失：不跳过，继续重建。
  }

  const { harness } = engine();
  const report = await harness.buildHarnessReport({ workspaceRoot: dir, includeBootstrap: true, checkOnly: false });
  // Essential for a mirror: Neo4j projection (+ semantic lifecycle). A missing
  // workspace .qea surfaces the harness overall status as failed, but a member
  // repo ships its own .qea; treat only the projection as the required gate.
  const neo4jOk = !!(report.neo4j && report.neo4j.status === 'ok');
  const semanticOk = !!(report.semanticLifecycle && report.semanticLifecycle.status === 'ok');
  // meta.ok 反映"投影 + 语义"两者是否都就绪，供 mirror_list 与幂等判断使用。
  writeMeta(projectId, { commit, ok: neo4jOk && semanticOk, neo4jOk, semanticOk, syncedAt: new Date().toISOString() });
  return {
    status: neo4jOk ? 'ok' : 'failed',
    synced: true,
    reason: meta ? 'updated' : 'created',
    projectId,
    workspaceRoot: dir,
    namespaceKey: `proj:${projectId}`,
    commit,
    neo4j: report.neo4j && { status: report.neo4j.status, database: report.neo4j.database },
    semanticLifecycle: report.semanticLifecycle && { status: report.semanticLifecycle.status, state: report.semanticLifecycle.state, ok: semanticOk },
    qeaFullProjection: report.qeaFullProjection && report.qeaFullProjection.status,
    reportPath: path.join(dir, '.argo', 'temp', 'argo-harness-init-report.json'),
  };
}

async function read(input) {
  const startedAt = Date.now();
  const result = await readInner(input);
  obs.append('engine', {
    kind: 'read',
    projectId: input && input.projectId,
    tool: input && input.tool,
    status: result.status,
    reason: result.reason,
    durationMs: Date.now() - startedAt,
  });
  return result;
}

async function readInner(input) {
  const projectId = safeId(input.projectId);
  if (!READ_TOOLS.has(input.tool)) return { status: 'bad_request', reason: `tool_not_allowed:${input.tool}` };
  const dir = workdir(projectId);
  if (!fs.existsSync(path.join(dir, DEFAULT_GRAPH_PATH))) return { status: 'denied', reason: 'mirror_not_synced', projectId };
  const { mcp } = engine();
  const result = await mcp.callTool(input.tool, { ...(input.args || {}), workspaceRoot: dir });
  return { status: 'ok', projectId, tool: input.tool, result };
}

function extractToolJson(result) {
  if (result && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
    try { return JSON.parse(result.content[0].text); } catch { return null; }
  }
  return result || null;
}

async function schemaInfo(input) {
  const startedAt = Date.now();
  const projectId = safeId(input && input.projectId);
  const dir = workdir(projectId);
  let out;
  if (!fs.existsSync(path.join(dir, DEFAULT_GRAPH_PATH))) {
    out = { status: 'denied', reason: 'mirror_not_synced', projectId };
  } else {
    try {
      const { mcp } = engine();
      const parsed = extractToolJson(await mcp.callTool('queryNeo4jGraph', { schema: true, workspaceRoot: dir }));
      const schema = parsed && (parsed.schema || parsed);
      const elementTypes = schema && (schema.archimateElementTypes || schema.elementTypes);
      const relationshipTypes = schema && (schema.archimateRelationshipTypes || schema.relationshipTypes);
      if (!schema || !Array.isArray(elementTypes)) {
        out = { status: 'failed', reason: 'schema_unparsable', projectId };
      } else {
        out = {
          status: 'ok',
          projectId,
          schema: {
            schemaKind: schema.schemaKind || null,
            schemaLanguage: schema.schemaLanguage || null,
            elementTypes: elementTypes.map(String),
            relationshipTypes: Array.isArray(relationshipTypes) ? relationshipTypes.map(String) : [],
            closed: true,
            source: 'engine',
          },
        };
      }
    } catch (e) {
      out = { status: 'failed', reason: 'schema_failed', projectId, error: String(e && e.message ? e.message : e) };
    }
  }
  obs.append('engine', {
    kind: 'schema',
    projectId,
    status: out.status,
    reason: out.reason,
    schemaKind: out.schema ? out.schema.schemaKind : null,
    elementTypeCount: out.schema ? out.schema.elementTypes.length : 0,
    durationMs: Date.now() - startedAt,
    argoVersion: argoVersion(),
  });
  return out;
}

async function remove(input) {
  const projectId = safeId(input.projectId);
  let dropped = false;
  try {
    const { store } = engine();
    const config = store.getNeo4jConfig({ database: 'system' });
    const driver = store.createDriver(config);
    const session = driver.session({ database: 'system' });
    const db = projectId.replace(/`/g, '');
    try { await session.run(`STOP DATABASE \`${db}\` IF EXISTS`); } catch { /* ignore */ }
    try { await session.run(`DROP DATABASE \`${db}\` IF EXISTS`); dropped = true; } catch { /* ignore */ }
    await session.close();
    await driver.close();
  } catch { /* best-effort */ }
  const dir = workdir(projectId);
  const existed = fs.existsSync(dir);
  if (existed) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(metaPath(projectId), { force: true });
  return { status: 'ok', projectId, databaseDropped: dropped, workspaceRemoved: existed };
}

function list() {
  if (!fs.existsSync(MIRRORS_ROOT)) return [];
  return fs.readdirSync(MIRRORS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => {
      const graphAbs = path.join(MIRRORS_ROOT, d.name, DEFAULT_GRAPH_PATH);
      const meta = readMeta(d.name);
      const ok = !!(meta && meta.ok);
      return {
        projectId: d.name,
        synced: fs.existsSync(graphAbs) && ok,
        ok,
        commit: (meta && meta.commit) || null,
        syncedAt: (meta && meta.syncedAt) || null,
        neo4jOk: meta ? !!meta.neo4jOk : false,
        semanticOk: meta ? !!meta.semanticOk : false,
      };
    });
}

// ---------- HTTP ----------
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { const raw = Buffer.concat(chunks).toString('utf8'); resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'argo-mirror-engine', argoRoot: ARGO_ROOT, mirrorsRoot: MIRRORS_ROOT, logDir: obs.logDir(), argoVersion: argoVersion(), activeSyncs: _activeSyncs, queuedSyncs: _syncQueue.length });
  }
  if (req.method === 'GET' && url.pathname === '/mirrors') {
    return sendJson(res, 200, { status: 'ok', count: list().length, mirrors: list() });
  }
  if (req.method === 'POST' && (url.pathname === '/mirror/sync' || url.pathname === '/mirror/remove' || url.pathname === '/graph/read' || url.pathname === '/schema')) {
    try {
      const body = await readBody(req);
      const result = url.pathname === '/mirror/sync' ? await runSync(() => sync(body))
        : url.pathname === '/mirror/remove' ? await remove(body)
        : url.pathname === '/schema' ? await schemaInfo(body)
        : await read(body);
      const status = result.status === 'ok' ? 200 : result.status === 'denied' ? 403 : result.status === 'bad_request' ? 400 : 502;
      return sendJson(res, status, result);
    } catch (e) {
      return sendJson(res, 500, { status: 'failed', error: String(e && e.message ? e.message : e) });
    }
  }
  return sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  obs.append('engine', { kind: 'start', host: HOST, port: PORT, argoRoot: ARGO_ROOT, mirrorsRoot: MIRRORS_ROOT, logDir: obs.logDir(), argoVersion: argoVersion() });
  console.log(`[argo-mirror-engine] listening on http://${HOST}:${PORT} (argo ${ARGO_ROOT}, mirrors ${MIRRORS_ROOT})`);
});
