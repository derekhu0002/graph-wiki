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

// ---------- MCP 处理 ----------

const TOOLS = [
  { name: 'graph_list', description: '列出图谱资产', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_get', description: '获取一张图谱资产（元数据 + 完整 ARCHGRAPH 图谱）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'graph_submit', description: '提交新图谱资产（内部自动 ARCHGRAPH schema 校验，不通过则拒收不入库）', inputSchema: { type: 'object', required: ['id', 'graph'], properties: { id: { type: 'string' }, graph: { type: 'object' }, name: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' } } } },
  { name: 'graph_update', description: '更新图谱资产（内部自动 ARCHGRAPH schema 校验，不通过则拒收不入库）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, graph: { type: 'object' }, version: { type: 'string' }, description: { type: 'string' }, name: { type: 'string' } } } },
];

const TOOL_HANDLERS = {
  graph_list: toolGraphList,
  graph_get: toolGraphGet,
  graph_submit: toolGraphSubmit,
  graph_update: toolGraphUpdate,
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'graph-mcp' });
  }
  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, {
      service: '图谱资产 MCP HTTP/SSE 服务',
      endpoints: { mcp: 'POST /mcp', health: 'GET /health' },
      assetRoot: ASSET_ROOT,
      tools: TOOLS.map((t) => t.name),
    });
  }
  if (req.method === 'POST' && url.pathname === '/mcp') {
    return handleMcpRequest(req, res);
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
