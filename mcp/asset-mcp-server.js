#!/usr/bin/env node
/**
 * 图谱资产 MCP HTTP/SSE 服务
 *
 * 供本机 AGENT 通过远程 MCP 查询/获取/提交 AI 组织图谱资产。
 * 资产即整张 ARCHGRAPH 图谱（elements/relationships/views，ArchiMate 类型体系），
 * 参考 teamai-cli 的思路：Git 仓库管理 + MCP 服务分发。
 *
 * 传输: MCP Streamable HTTP (protocol 2024-11-05 / 2025-03-26 兼容)
 *   POST /mcp      接收 JSON-RPC 请求 (application/json 或 text/event-stream)
 *   GET  /health   健康检查
 *   GET  /         服务信息
 *
 * 工具:
 *   graph_list      列出图谱资产
 *   graph_get       获取一张图谱资产（元数据 + 完整图谱）
 *   graph_submit    提交新图谱资产（内部自动 schema 校验，不过拒收）
 *   graph_update    更新图谱资产（内部自动 schema 校验，不过拒收）
 *
 * 所有写入接口（graph_submit/graph_update）内部自动执行 ARCHGRAPH schema 校验，
 * 校验不通过则返回错误并停止入库。变更入口唯一化，不支持外部直接写文件。
 *
 * 环境变量:
 *   ASSET_MCP_PORT   监听端口（默认 18792）
 *   ASSET_MCP_HOST   监听地址（默认 127.0.0.1）
 *   ASSET_REPO_ROOT  图谱仓库根（含 assets/ 和 .git）
 *   ASSET_ROOT       资产根目录（默认 <repo>/assets）
 *   ASSET_GIT_DIR    git 提交目录（默认 <repo>）
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const registry = require('./registry.js');
const mirror = require('./mirror.js');
const externalRead = require('./external-read.js');
const { validateGraph } = require('./graph-schema.js');

const PORT = Number(process.env.ASSET_MCP_PORT || 18792);
const HOST = process.env.ASSET_MCP_HOST || '127.0.0.1';

function resolveRepoRoot() {
  if (process.env.ASSET_REPO_ROOT && process.env.ASSET_REPO_ROOT.trim() !== '') {
    return path.resolve(process.env.ASSET_REPO_ROOT);
  }
  let dir = __dirname;
  while (true) {
    if (fs.existsSync(path.join(dir, 'assets', 'catalog.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const REPO_ROOT = resolveRepoRoot();
const ASSET_ROOT = path.resolve(process.env.ASSET_ROOT || path.join(REPO_ROOT, 'assets'));
const GIT_DIR = path.resolve(process.env.ASSET_GIT_DIR || REPO_ROOT);
const CATALOG_PATH = path.join(ASSET_ROOT, 'catalog.json');
const GRAPHS_DIR = path.join(ASSET_ROOT, 'graphs');
const REGISTRY_PATH = path.join(ASSET_ROOT, 'registry', 'registry.json');
const MIRROR_ROOT = path.join(ASSET_ROOT, 'mirrors');

// ---------- catalog 读写 ----------

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    return { schemaVersion: '1.0', lastUpdated: new Date().toISOString().slice(0, 10), graphs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch {
    return { schemaVersion: '1.0', lastUpdated: new Date().toISOString().slice(0, 10), graphs: [] };
  }
}

function saveCatalog(catalog) {
  catalog.lastUpdated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

// ---------- git 提交 ----------

function gitCommit(message, files) {
  if (!fs.existsSync(path.join(GIT_DIR, '.git'))) {
    return { committed: false, reason: 'not a git repo' };
  }
  try {
    const rel = files.map((f) => path.relative(GIT_DIR, f).split('\\').join('/'));
    execFileSync('git', ['-C', GIT_DIR, 'add', ...rel], { stdio: 'pipe' });
    execFileSync('git', ['-C', GIT_DIR, 'commit', '-m', message], { stdio: 'pipe' });
    const hash = execFileSync('git', ['-C', GIT_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return { committed: true, commit: hash };
  } catch (error) {
    const stderr = String(error.stderr || error.message || '');
    if (stderr.includes('nothing to commit') || stderr.includes('no changes')) {
      return { committed: false, reason: 'no changes' };
    }
    return { committed: false, reason: stderr.split('\n')[0] || error.message };
  }
}

// ---------- ARCHGRAPH 图谱 Schema 校验 ----------
// 共享校验逻辑位于 graph-schema.js（服务与验收测试、联邦副本托管共用同一套规则）。

// ---------- 图谱资产读写 ----------

function graphRelPath(graphId) {
  return path.posix.join('graphs', graphId, 'graph.json');
}

function graphAbsPath(graphId) {
  return path.join(ASSET_ROOT, graphRelPath(graphId));
}

function listGraphEntries() {
  const catalog = loadCatalog();
  return (catalog.graphs || []).map((g) => ({
    id: g.id,
    name: g.name,
    version: g.version,
    sourceRepo: g.sourceRepo,
    sourceCommit: g.sourceCommit,
    description: g.description,
    stats: g.stats,
  }));
}

function findGraphEntry(graphId) {
  const catalog = loadCatalog();
  return (catalog.graphs || []).find((g) => g.id === graphId);
}

function readGraph(graphId) {
  const abs = graphAbsPath(graphId);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function graphStats(graph) {
  return {
    elements: (graph.elements || []).length,
    relationships: (graph.relationships || []).length,
    views: (graph.views || []).length,
  };
}

// ---------- 工具实现 ----------

function toolGraphList() {
  return { status: 'ok', count: listGraphEntries().length, graphs: listGraphEntries() };
}

function toolGraphGet(args) {
  const id = args && args.id;
  if (!id) throw new Error('缺少 id');
  const entry = findGraphEntry(id);
  if (!entry) throw new Error(`图谱资产未找到: ${id}`);
  const graph = readGraph(id);
  if (!graph) throw new Error(`图谱文件缺失或损坏: ${id}`);
  return {
    status: 'ok',
    asset: {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      sourceRepo: entry.sourceRepo,
      sourceCommit: entry.sourceCommit,
      description: entry.description,
    },
    graph: { name: graph.name, description: graph.description, ...graphStats(graph) },
    content: graph,
  };
}

function toolGraphSubmit(args) {
  const { id, graph, version, description, name, sourceRepo } = args || {};
  if (!id) throw new Error('缺少 id（图谱资产 id）');
  if (!graph || typeof graph !== 'object') throw new Error('缺少 graph（ARCHGRAPH 图谱对象）');

  // 内部自动 schema 校验，不过拒收
  const validation = validateGraph(graph);
  if (!validation.valid) {
    return { status: 'failed', reason: 'schema_validation_failed', errors: validation.errors };
  }

  const catalog = loadCatalog();
  if ((catalog.graphs || []).some((g) => g.id === id)) {
    throw new Error(`图谱资产已存在: ${id}（用 graph_update 更新）`);
  }

  // 写入 assets/graphs/<id>/graph.json
  const graphFile = graphAbsPath(id);
  fs.mkdirSync(path.dirname(graphFile), { recursive: true });
  fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2) + '\n', 'utf8');

  catalog.graphs = catalog.graphs || [];
  catalog.graphs.push({
    id,
    name: name || graph.name || id,
    version: version || '1.0.0',
    path: graphRelPath(id),
    sourceRepo: sourceRepo || path.basename(REPO_ROOT),
    sourceCommit: 'pending',
    description: description || (typeof graph.description === 'string' ? graph.description : '') || '',
    stats: graphStats(graph),
  });
  saveCatalog(catalog);

  const commitResult = gitCommit(`feat(graphs): submit graph ${id}`, [graphFile, CATALOG_PATH]);
  if (commitResult.committed) {
    catalog.graphs.find((g) => g.id === id).sourceCommit = commitResult.commit;
    saveCatalog(catalog);
  }
  return {
    status: 'ok',
    graphId: id,
    validation: { valid: true, errors: [] },
    stats: graphStats(graph),
    commit: commitResult,
  };
}

function toolGraphUpdate(args) {
  const { id, graph, version, description, name } = args || {};
  if (!id) throw new Error('缺少 id');
  const catalog = loadCatalog();
  const entry = (catalog.graphs || []).find((g) => g.id === id);
  if (!entry) throw new Error(`图谱资产未找到: ${id}（用 graph_submit 新建）`);

  const changed = [];
  if (graph != null) {
    if (typeof graph !== 'object') throw new Error('graph 必须是对象');
    // 内部自动 schema 校验，不过拒收
    const validation = validateGraph(graph);
    if (!validation.valid) {
      return { status: 'failed', reason: 'schema_validation_failed', errors: validation.errors };
    }
    const graphFile = graphAbsPath(id);
    fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2) + '\n', 'utf8');
    changed.push(graphFile);
    entry.stats = graphStats(graph);
  }
  if (version) { entry.version = version; changed.push(CATALOG_PATH); }
  if (description != null) { entry.description = description; changed.push(CATALOG_PATH); }
  if (name) { entry.name = name; changed.push(CATALOG_PATH); }
  if (changed.length > 0) saveCatalog(catalog);

  const commitResult = changed.length > 0
    ? gitCommit(`chore(graphs): update graph ${id}`, changed)
    : { committed: false, reason: 'no changes' };
  if (commitResult.committed) {
    entry.sourceCommit = commitResult.commit;
    saveCatalog(catalog);
  }
  return { status: 'ok', graphId: id, commit: commitResult };
}

// ---------- 联邦注册中心 Registry（P0 只读） ----------

function toolRegistryRegister(args) {
  const reg = registry.load(REGISTRY_PATH);
  const member = registry.registerMember(reg, args);
  registry.save(REGISTRY_PATH, reg);
  const commitResult = gitCommit(`feat(registry): register member ${member.id}`, [REGISTRY_PATH]);
  return { status: 'ok', member: registry.discover(reg).find((m) => m.id === member.id), commit: commitResult };
}

function toolRegistryDeregister(args) {
  const id = args && args.id;
  if (!id) throw new Error('缺少 id');
  const reg = registry.load(REGISTRY_PATH);
  const result = registry.deregisterMember(reg, id);
  registry.save(REGISTRY_PATH, reg);
  const mirrorResult = mirror.remove(MIRROR_ROOT, id);
  const commitResult = gitCommit(`feat(registry): deregister member ${id}`, [REGISTRY_PATH]);
  return { status: 'ok', ...result, mirror: mirrorResult, commit: commitResult };
}

function toolRegistryDiscover() {
  const reg = registry.load(REGISTRY_PATH);
  const members = registry.discover(reg);
  return { status: 'ok', count: members.length, members };
}

function toolRegistryAuthorize(args) {
  const reg = registry.load(REGISTRY_PATH);
  const grant = registry.authorize(reg, args);
  registry.save(REGISTRY_PATH, reg);
  const commitResult = gitCommit(
    `feat(registry): grant ${grant.grantor} -> ${grant.grantee} (${grant.contentId})`,
    [REGISTRY_PATH]
  );
  return { status: 'ok', grant, commit: commitResult };
}

function toolRegistryRead(args) {
  const reg = registry.load(REGISTRY_PATH);
  return registry.readAuthorized(reg, args);
}

// ---------- 跨项目图谱查询（外部图读取）+ 副本托管 ----------

function toolGraphReadExternal(args) {
  const a = args || {};
  if (!a.requester) throw new Error('缺少 requester（请求方项目 id）');
  if (!a.projectId) throw new Error('缺少 projectId（被查项目 id）');
  return externalRead.readExternal({
    registryPath: REGISTRY_PATH,
    mirrorRoot: MIRROR_ROOT,
    requester: a.requester,
    projectId: a.projectId,
    contentId: a.contentId,
    op: a.op,
    id: a.id,
    type: a.type,
    text: a.text,
    limit: a.limit,
    depth: a.depth,
  });
}

function toolMirrorSync(args) {
  const a = args || {};
  if (!a.projectId) throw new Error('缺少 projectId');
  const reg = registry.load(REGISTRY_PATH);
  const member = (reg.members || []).find((m) => m.id === a.projectId && m.status === 'active');
  if (!member) throw new Error(`成员未注册或已注销: ${a.projectId}`);
  const result = mirror.sync(MIRROR_ROOT, a.projectId, {
    sourceRepo: a.sourceRepo || member.sourceRepo,
    branch: a.branch || member.branch || mirror.DEFAULT_BRANCH,
    graphPath: a.graphPath,
    commit: a.commit,
  });
  return { status: 'ok', ...result };
}

function toolMirrorList() {
  const mirrors = mirror.list(MIRROR_ROOT);
  return { status: 'ok', count: mirrors.length, mirrors };
}

// ---------- MCP 处理 ----------

const TOOLS = [
  { name: 'graph_list', description: '列出图谱资产', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_get', description: '获取一张图谱资产（元数据 + 完整 ARCHGRAPH 图谱）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'graph_submit', description: '提交新图谱资产（内部自动 ARCHGRAPH schema 校验，不通过则拒收不入库）', inputSchema: { type: 'object', required: ['id', 'graph'], properties: { id: { type: 'string' }, graph: { type: 'object' }, name: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' } } } },
  { name: 'graph_update', description: '更新图谱资产（内部自动 ARCHGRAPH schema 校验，不通过则拒收不入库）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, graph: { type: 'object' }, version: { type: 'string' }, description: { type: 'string' }, name: { type: 'string' } } } },
  { name: 'registry_register', description: '联邦成员自注册到中心（身份/职责/能力/开放内容清单）。中心只存元数据与授权，不存内容副本', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, capabilities: { type: 'array' }, openContent: { type: 'array' }, sourceRepo: { type: 'string' } } } },
  { name: 'registry_deregister', description: '联邦成员自注销，注销后 discover 不再可见', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'registry_discover', description: '发现已注册联邦成员的基础信息（它是谁、做什么、有什么能力）', inputSchema: { type: 'object', properties: {} } },
  { name: 'registry_authorize', description: '成员显式授权某请求方读取其对外开放内容；未授权默认拒绝', inputSchema: { type: 'object', required: ['grantor', 'grantee'], properties: { grantor: { type: 'string' }, grantee: { type: 'string' }, contentId: { type: 'string' } } } },
  { name: 'registry_read', description: '授权后读取成员开放内容（返回引用，非副本）；未授权默认拒绝', inputSchema: { type: 'object', required: ['requester', 'member'], properties: { requester: { type: 'string' }, member: { type: 'string' }, contentId: { type: 'string' } } } },
  { name: 'graph_read_external', description: '跨项目图谱查询：授权后在中心托管的成员副本命名空间内查询（不复用 registry_read）；未授权默认拒绝', inputSchema: { type: 'object', required: ['requester', 'projectId'], properties: { requester: { type: 'string' }, projectId: { type: 'string' }, contentId: { type: 'string' }, op: { type: 'string' }, id: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' }, limit: { type: 'number' }, depth: { type: 'number' } } } },
  { name: 'mirror_sync', description: '按成员已审核分支同步其仓到中心副本（投影+向量化），按 git 版本幂等', inputSchema: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' }, sourceRepo: { type: 'string' }, branch: { type: 'string' }, graphPath: { type: 'string' }, commit: { type: 'string' } } } },
  { name: 'mirror_list', description: '列出中心已托管的成员副本', inputSchema: { type: 'object', properties: {} } },
];

const TOOL_HANDLERS = {
  graph_list: toolGraphList,
  graph_get: toolGraphGet,
  graph_submit: toolGraphSubmit,
  graph_update: toolGraphUpdate,
  registry_register: toolRegistryRegister,
  registry_deregister: toolRegistryDeregister,
  registry_discover: toolRegistryDiscover,
  registry_authorize: toolRegistryAuthorize,
  registry_read: toolRegistryRead,
  graph_read_external: toolGraphReadExternal,
  mirror_sync: toolMirrorSync,
  mirror_list: toolMirrorList,
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handleMcpRequest(req, res) {
  let request;
  try {
    request = await readBody(req);
  } catch (error) {
    return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: ' + error.message } });
  }
  if (!request || typeof request !== 'object' || !request.method) {
    return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  }

  const { id, method, params } = request;
  let response;

  if (method === 'initialize') {
    response = {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'graph-mcp', version: '1.0.0' },
      },
    };
  } else if (method === 'notifications/initialized') {
    return sendJson(res, 202, {});
  } else if (method === 'tools/list') {
    response = { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  } else if (method === 'tools/call') {
    try {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const handler = TOOL_HANDLERS[name];
      if (!handler) throw new Error(`未知工具: ${name}`);
      const result = handler(args);
      response = {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      };
    } catch (error) {
      response = {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify({ status: 'failed', error: error.message }) }], isError: true },
      };
    }
  } else if (method === 'ping') {
    response = { jsonrpc: '2.0', id, result: {} };
  } else {
    response = { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  const accept = String(req.headers.accept || '');
  if (accept.includes('text/event-stream')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(response)}\n\n`);
    return res.end();
  }
  if (!response) return sendJson(res, 202, {});
  return sendJson(res, 200, response);
}

// 普通 REST 只读端点：供 ARGO MCP 直接 HTTP 调用，不掺 MCP-in-MCP。
async function handleRestGraphRead(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return sendJson(res, 400, { status: 'bad_request', error: error.message });
  }
  try {
    const result = toolGraphReadExternal(body);
    const httpStatus = result && result.status === 'denied' ? 403
      : result && result.status === 'bad_request' ? 400
      : 200;
    return sendJson(res, httpStatus, result);
  } catch (error) {
    return sendJson(res, 400, { status: 'bad_request', error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'graph-mcp' });
  }
  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, {
      service: '图谱资产 MCP HTTP/SSE 服务',
      endpoints: { mcp: 'POST /mcp', graphRead: 'POST /graph/read', health: 'GET /health' },
      assetRoot: ASSET_ROOT,
      tools: TOOLS.map((t) => t.name),
    });
  }
  if (req.method === 'POST' && url.pathname === '/mcp') {
    return handleMcpRequest(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/graph/read') {
    return handleRestGraphRead(req, res);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    });
    return res.end();
  }
  sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[graph-mcp] listening on http://${HOST}:${PORT}`);
  console.log(`[graph-mcp] asset root: ${ASSET_ROOT}`);
  console.log(`[graph-mcp] git dir: ${GIT_DIR}`);
});
