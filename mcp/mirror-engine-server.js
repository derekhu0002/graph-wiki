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
const { execFileSync } = require('node:child_process');

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
function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

function fetchRepo(projectId, sourceRepo, branch) {
  const dir = workdir(projectId);
  const branchName = branch || 'main';
  if (!sourceRepo) return dir;
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    git(['clone', '--depth', '1', '--branch', branchName, sourceRepo, '.'], dir);
  } else {
    git(['fetch', '--depth', '1', 'origin', branchName], dir);
    git(['reset', '--hard', `origin/${branchName}`], dir);
  }
  return dir;
}

async function sync(input) {
  const projectId = safeId(input.projectId);
  const dir = fetchRepo(projectId, input.sourceRepo, input.branch);
  const graphAbs = path.join(dir, DEFAULT_GRAPH_PATH);
  if (!fs.existsSync(graphAbs)) return { status: 'failed', reason: 'graph_not_found', projectId, graphAbs };
  const { harness } = engine();
  const report = await harness.buildHarnessReport({ workspaceRoot: dir, includeBootstrap: true, checkOnly: false });
  let commit = null;
  try { commit = git(['rev-parse', 'HEAD'], dir); } catch { /* not a git dir */ }
  // Essential for a mirror: Neo4j projection (+ semantic lifecycle). A missing
  // workspace .qea surfaces the harness overall status as failed, but a member
  // repo ships its own .qea; treat only the projection as the required gate.
  const neo4jOk = !!(report.neo4j && report.neo4j.status === 'ok');
  const semanticOk = !!(report.semanticLifecycle && report.semanticLifecycle.status === 'ok');
  return {
    status: neo4jOk ? 'ok' : 'failed',
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
  const projectId = safeId(input.projectId);
  if (!READ_TOOLS.has(input.tool)) return { status: 'bad_request', reason: `tool_not_allowed:${input.tool}` };
  const dir = workdir(projectId);
  if (!fs.existsSync(path.join(dir, DEFAULT_GRAPH_PATH))) return { status: 'denied', reason: 'mirror_not_synced', projectId };
  const { mcp } = engine();
  const result = await mcp.callTool(input.tool, { ...(input.args || {}), workspaceRoot: dir });
  return { status: 'ok', projectId, tool: input.tool, result };
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
  return { status: 'ok', projectId, databaseDropped: dropped, workspaceRemoved: existed };
}

function list() {
  if (!fs.existsSync(MIRRORS_ROOT)) return [];
  return fs.readdirSync(MIRRORS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const graphAbs = path.join(MIRRORS_ROOT, d.name, DEFAULT_GRAPH_PATH);
      return { projectId: d.name, synced: fs.existsSync(graphAbs) };
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
    return sendJson(res, 200, { status: 'ok', service: 'argo-mirror-engine', argoRoot: ARGO_ROOT, mirrorsRoot: MIRRORS_ROOT });
  }
  if (req.method === 'GET' && url.pathname === '/mirrors') {
    return sendJson(res, 200, { status: 'ok', count: list().length, mirrors: list() });
  }
  if (req.method === 'POST' && (url.pathname === '/mirror/sync' || url.pathname === '/mirror/remove' || url.pathname === '/graph/read')) {
    try {
      const body = await readBody(req);
      const result = url.pathname === '/mirror/sync' ? await sync(body)
        : url.pathname === '/mirror/remove' ? await remove(body)
        : await read(body);
      const status = result.status === 'ok' ? 200 : result.status === 'denied' ? 403 : result.status === 'bad_request' ? 400 : 502;
      return sendJson(res, status, result);
    } catch (e) {
      return sendJson(res, 500, { status: 'failed', error: String(e && e.message ? e.message : e) });
    }
  }
  return sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, HOST, () => console.log(`[argo-mirror-engine] listening on http://${HOST}:${PORT} (argo ${ARGO_ROOT}, mirrors ${MIRRORS_ROOT})`));
