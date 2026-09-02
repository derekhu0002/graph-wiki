#!/usr/bin/env node
/**
 * AI 组织资产 MCP HTTP/SSE 服务
 *
 * 参考 teamai-cli 的做法：用 Git 仓库管理组织资产（skills/rules/agents/hooks/mcp/docs），
 * 通过 MCP over HTTP/SSE 提供远程服务，供本机 AGENT 查询/获取/提交 AI 组织资产。
 *
 * 传输: MCP Streamable HTTP (protocol 2024-11-05 / 2025-03-26 兼容)
 *   POST /mcp      接收 JSON-RPC 请求 (application/json 或 text/event-stream)
 *   GET  /health   健康检查
 *   GET  /         服务信息
 *
 * 工具:
 *   asset_list      列出资产（可按类型过滤）
 *   asset_get       获取单个资产（元数据 + 内容）
 *   asset_search    关键词搜索资产
 *   asset_register  登记/提交新资产（写入分类目录 + 更新 catalog.json + git commit）
 *   asset_update    更新资产（内容/元数据 + git commit）
 *   graph_list      列出图谱资产
 *   graph_get       获取一张图谱资产
 *   graph_validate  校验一张 ARCHGRAPH 图谱（提交前自检）
 *   graph_submit    提交新图谱资产（schema 校验 + 写入 + catalog + git commit）
 *   graph_update    更新图谱资产
 *
 * 图谱资产：整张 ARCHGRAPH 图谱（elements/relationships/views，ArchiMate 类型体系）
 * 作为 assets/graphs/<id>/graph.json 存储，提交时做 schema 校验（结构 + 类型 + 引用完整性）。
 *
 * 变更入口唯一化：所有资产变更必须通过 asset_register/asset_update/graph_submit/graph_update
 * （内部自动 git commit），不允许外部直接写 assets/ 文件。
 *
 * 环境变量:
 *   ASSET_MCP_PORT   监听端口（默认 18792）
 *   ASSET_MCP_HOST   监听地址（默认 127.0.0.1）
 *   ASSET_ROOT       资产根目录（默认 <repo>/assets）
 *   ASSET_GIT_DIR    若设置，提交时 git -C 到该目录（默认 <repo>）
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

const ASSET_TYPES = ['AGENT', 'SKILL', 'RULE', 'HOOKS', 'KNOWLEDGE', 'GRAPH'];
const TYPE_DIRS = {
  AGENT: 'agents',
  SKILL: 'skills',
  RULE: 'rules',
  HOOKS: 'hooks',
  KNOWLEDGE: 'knowledge',
  GRAPH: 'graphs',
};

// ---------- catalog 读写 ----------

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    return { schemaVersion: '1.0', lastUpdated: new Date().toISOString().slice(0, 10), assets: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch {
    return { schemaVersion: '1.0', lastUpdated: new Date().toISOString().slice(0, 10), assets: [] };
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

function validateArchGraph(graph) {
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
  const elementByName = new Map();
  const duplicateIds = [];
  for (const e of graph.elements) {
    if (!e || typeof e !== 'object') { errors.push('element must be an object'); continue; }
    for (const f of ['id', 'name', 'type']) {
      if (typeof e[f] !== 'string' || e[f].trim() === '') errors.push(`element missing ${f}: ${e.name || '?'}`);
    }
    if (e.id && elementIds.has(e.id)) duplicateIds.push(e.id);
    elementIds.add(e.id);
    if (e.type && !ARCH_ELEMENT_TYPES.includes(e.type)) {
      errors.push(`element "${e.name || e.id}" has invalid ArchiMate type "${e.type}"`);
    }
    if (e.type && e.name) elementByName.set(`${e.type}:${e.name}`, e);
  }
  if (duplicateIds.length > 0) errors.push(`duplicate element ids: ${duplicateIds.join(', ')}`);

  for (const r of graph.relationships) {
    if (!r || typeof r !== 'object') { errors.push('relationship must be an object'); continue; }
    for (const f of ['id', 'type', 'source_id', 'target_id', 'source_name', 'target_name']) {
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

  // 顶层视图唯一性（最多一个无 parent 的顶层视图）
  const topViews = (graph.views || []).filter((v) => !v.parent_element_id);
  if (topViews.length > 1) {
    errors.push(`graph has ${topViews.length} top-level views; at most 1 allowed`);
  }

  return { valid: errors.length === 0, errors };
}

// ---------- 图谱资产处理 ----------

function graphsDir() {
  const dir = path.join(ASSET_ROOT, 'graphs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function graphAssetPath(graphId) {
  return path.posix.join('graphs', graphId, 'graph.json');
}

function readGraphContent(graphId) {
  const rel = graphAssetPath(graphId);
  const abs = path.join(ASSET_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- 资产读取 ----------

function readAssetContent(assetPath) {
  const abs = path.join(ASSET_ROOT, assetPath);
  if (!fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const files = [];
    for (const f of fs.readdirSync(abs)) {
      const p = path.join(abs, f);
      if (fs.statSync(p).isFile()) {
        files.push({ name: f, content: fs.readFileSync(p, 'utf8') });
      }
    }
    // 若是图谱目录且含 graph.json，额外返回解析后的图谱结构
    const graphJson = files.find((f) => f.name === 'graph.json');
    let graph = null;
    if (graphJson) {
      try { graph = JSON.parse(graphJson.content); } catch { graph = null; }
    }
    return { type: 'dir', files, graph };
  }
  // graph.json 单文件路径
  if (path.basename(abs) === 'graph.json') {
    try { return { type: 'graph', graph: JSON.parse(fs.readFileSync(abs, 'utf8')) }; } catch { /* fallthrough */ }
  }
  return { type: 'file', content: fs.readFileSync(abs, 'utf8') };
}

function listAssets(typeFilter) {
  const catalog = loadCatalog();
  let assets = catalog.assets || [];
  if (typeFilter) {
    assets = assets.filter((a) => String(a.type).toUpperCase() === String(typeFilter).toUpperCase());
  }
  return assets.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    version: a.version,
    path: a.path,
    sourceRepo: a.sourceRepo,
    sourceCommit: a.sourceCommit,
    description: a.description,
  }));
}

function findAsset(id) {
  const catalog = loadCatalog();
  return (catalog.assets || []).find((a) => a.id === id);
}

function buildAssetId(kind, name) {
  const k = String(kind).toLowerCase();
  const n = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${k}-${n}`;
}

// ---------- 工具实现 ----------

function toolAssetList(args) {
  const assets = listAssets(args && args.type);
  return { status: 'ok', count: assets.length, assets };
}

function toolAssetGet(args) {
  const id = args && args.id;
  if (!id) throw new Error('缺少 id');
  const asset = findAsset(id);
  if (!asset) throw new Error(`资产未找到: ${id}`);
  const content = readAssetContent(asset.path);
  return { status: 'ok', asset: { ...asset, content } };
}

function toolAssetSearch(args) {
  const q = String((args && args.query) || '').toLowerCase().trim();
  if (!q) throw new Error('缺少 query');
  const assets = listAssets();
  const hits = assets
    .filter((a) =>
      [a.name, a.id, a.description, a.type].some((v) => String(v || '').toLowerCase().includes(q))
    )
    .map((a) => ({ id: a.id, type: a.type, name: a.name, version: a.version, description: a.description }));
  return { status: 'ok', count: hits.length, assets: hits };
}

function toolAssetRegister(args) {
  const { id, type, name, content, version, description, sourceRepo } = args || {};
  if (!id) throw new Error('缺少 id');
  const t = String(type || '').toUpperCase();
  if (!ASSET_TYPES.includes(t)) {
    throw new Error(`非法资产类型: ${type}。合法: ${ASSET_TYPES.join(', ')}`);
  }
  if (t === 'GRAPH') {
    throw new Error('GRAPH 类型请使用 graph_submit / graph_update 工具（校验 ARCHGRAPH schema 后提交）');
  }
  if (content == null) throw new Error('缺少 content（资产内容）');
  const catalog = loadCatalog();
  if ((catalog.assets || []).some((a) => a.id === id)) {
    throw new Error(`资产已存在: ${id}（用 update 更新）`);
  }

  const dirName = TYPE_DIRS[t];
  const ext = t === 'RULE' || t === 'KNOWLEDGE' ? '.md' : '.md';
  const fileName = `${id}${ext}`;
  const relPath = path.posix.join(dirName, fileName);
  const absPath = path.join(ASSET_ROOT, dirName, fileName);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, String(content), 'utf8');

  catalog.assets = catalog.assets || [];
  catalog.assets.push({
    id,
    type: t,
    name: name || id,
    version: version || '1.0.0',
    path: relPath,
    sourceRepo: sourceRepo || path.basename(REPO_ROOT),
    sourceCommit: 'pending',
    description: description || '',
  });
  saveCatalog(catalog);

  const commitResult = gitCommit(`feat(assets): register ${id}`, [absPath, CATALOG_PATH]);
  if (commitResult.committed) {
    catalog.assets.find((a) => a.id === id).sourceCommit = commitResult.commit;
    saveCatalog(catalog);
  }
  return { status: 'ok', assetId: id, commit: commitResult };
}

function toolAssetUpdate(args) {
  const { id, content, version, description, name } = args || {};
  if (!id) throw new Error('缺少 id');
  const catalog = loadCatalog();
  const asset = (catalog.assets || []).find((a) => a.id === id);
  if (!asset) throw new Error(`资产未找到: ${id}（用 register 新建）`);

  const changed = [];
  if (content != null) {
    const abs = path.join(ASSET_ROOT, asset.path);
    fs.writeFileSync(abs, String(content), 'utf8');
    changed.push(abs);
  }
  if (version) { asset.version = version; changed.push(CATALOG_PATH); }
  if (description != null) { asset.description = description; changed.push(CATALOG_PATH); }
  if (name) { asset.name = name; changed.push(CATALOG_PATH); }
  if (changed.length > 0) saveCatalog(catalog);

  const commitResult = changed.length > 0
    ? gitCommit(`chore(assets): update ${id}`, changed)
    : { committed: false, reason: 'no changes' };
  if (commitResult.committed) {
    asset.sourceCommit = commitResult.commit;
    saveCatalog(catalog);
  }
  return { status: 'ok', assetId: id, commit: commitResult };
}

function toolAssetTypes() {
  return { status: 'ok', types: ASSET_TYPES, directories: TYPE_DIRS };
}

// ---------- 图谱工具 ----------

function graphCatalogEntry(graphId) {
  const catalog = loadCatalog();
  return (catalog.assets || []).find((a) => a.id === graphId && String(a.type).toUpperCase() === 'GRAPH');
}

function toolGraphList(args) {
  const catalog = loadCatalog();
  const graphs = (catalog.assets || []).filter((a) => String(a.type).toUpperCase() === 'GRAPH');
  return {
    status: 'ok',
    count: graphs.length,
    graphs: graphs.map((g) => ({
      id: g.id,
      name: g.name,
      version: g.version,
      path: g.path,
      sourceRepo: g.sourceRepo,
      sourceCommit: g.sourceCommit,
      description: g.description,
    })),
  };
}

function toolGraphGet(args) {
  const id = args && args.id;
  if (!id) throw new Error('缺少 id');
  const entry = graphCatalogEntry(id);
  if (!entry) throw new Error(`图谱资产未找到: ${id}`);
  const graph = readGraphContent(id);
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
    graph: {
      name: graph.name,
      description: graph.description,
      elementCount: (graph.elements || []).length,
      relationshipCount: (graph.relationships || []).length,
      viewCount: (graph.views || []).length,
    },
    content: graph,
  };
}

function toolGraphValidate(args) {
  const graph = args && args.graph;
  if (!graph) throw new Error('缺少 graph（要校验的 ARCHGRAPH 图谱对象）');
  const result = validateArchGraph(graph);
  return { status: 'ok', ...result };
}

function toolGraphSubmit(args) {
  const { id, graph, version, description, name, sourceRepo } = args || {};
  if (!id) throw new Error('缺少 id（图谱资产 id）');
  if (!graph || typeof graph !== 'object') throw new Error('缺少 graph（ARCHGRAPH 图谱对象）');

  // schema 校验
  const validation = validateArchGraph(graph);
  if (!validation.valid) {
    return { status: 'failed', reason: 'schema_validation_failed', errors: validation.errors };
  }

  const catalog = loadCatalog();
  if ((catalog.assets || []).some((a) => a.id === id)) {
    throw new Error(`资产已存在: ${id}（用 asset_update 更新，或先删除）`);
  }

  // 写入 assets/graphs/<id>/graph.json
  const graphDir = path.join(graphsDir(), id);
  const graphFile = path.join(graphDir, 'graph.json');
  fs.mkdirSync(graphDir, { recursive: true });
  fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2) + '\n', 'utf8');

  // 登记 catalog
  catalog.assets = catalog.assets || [];
  catalog.assets.push({
    id,
    type: 'GRAPH',
    name: name || graph.name || id,
    version: version || '1.0.0',
    path: graphAssetPath(id),
    sourceRepo: sourceRepo || path.basename(REPO_ROOT),
    sourceCommit: 'pending',
    description: description || (typeof graph.description === 'string' ? graph.description : '') || '',
    graphStats: {
      elements: (graph.elements || []).length,
      relationships: (graph.relationships || []).length,
      views: (graph.views || []).length,
    },
  });
  saveCatalog(catalog);

  const commitResult = gitCommit(`feat(graphs): submit graph ${id}`, [graphFile, CATALOG_PATH]);
  if (commitResult.committed) {
    catalog.assets.find((a) => a.id === id).sourceCommit = commitResult.commit;
    saveCatalog(catalog);
  }
  return {
    status: 'ok',
    graphId: id,
    validation: { valid: true, errors: [] },
    stats: {
      elements: (graph.elements || []).length,
      relationships: (graph.relationships || []).length,
      views: (graph.views || []).length,
    },
    commit: commitResult,
  };
}

function toolGraphUpdate(args) {
  const { id, graph, version, description, name } = args || {};
  if (!id) throw new Error('缺少 id');
  const catalog = loadCatalog();
  const asset = (catalog.assets || []).find((a) => a.id === id && String(a.type).toUpperCase() === 'GRAPH');
  if (!asset) throw new Error(`图谱资产未找到: ${id}（用 graph_submit 新建）`);

  const changed = [];
  if (graph != null) {
    if (typeof graph !== 'object') throw new Error('graph 必须是对象');
    const validation = validateArchGraph(graph);
    if (!validation.valid) {
      return { status: 'failed', reason: 'schema_validation_failed', errors: validation.errors };
    }
    const graphFile = path.join(ASSET_ROOT, asset.path);
    fs.writeFileSync(graphFile, JSON.stringify(graph, null, 2) + '\n', 'utf8');
    changed.push(graphFile);
    asset.graphStats = {
      elements: (graph.elements || []).length,
      relationships: (graph.relationships || []).length,
      views: (graph.views || []).length,
    };
  }
  if (version) { asset.version = version; changed.push(CATALOG_PATH); }
  if (description != null) { asset.description = description; changed.push(CATALOG_PATH); }
  if (name) { asset.name = name; changed.push(CATALOG_PATH); }
  if (changed.length > 0) saveCatalog(catalog);

  const commitResult = changed.length > 0
    ? gitCommit(`chore(graphs): update graph ${id}`, changed)
    : { committed: false, reason: 'no changes' };
  if (commitResult.committed) {
    asset.sourceCommit = commitResult.commit;
    saveCatalog(catalog);
  }
  return { status: 'ok', graphId: id, commit: commitResult };
}

// ---------- MCP 处理 ----------

const TOOLS = [
  { name: 'asset_list', description: '列出 AI 组织资产（可按 type 过滤）', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ASSET_TYPES } } } },
  { name: 'asset_get', description: '获取单个资产（元数据 + 内容）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'asset_search', description: '关键词搜索资产', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } },
  { name: 'asset_register', description: '登记/提交新资产（写入分类目录 + 更新 catalog.json + git commit）', inputSchema: { type: 'object', required: ['id', 'type', 'content'], properties: { id: { type: 'string' }, type: { type: 'string', enum: ASSET_TYPES }, name: { type: 'string' }, content: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' } } } },
  { name: 'asset_update', description: '更新资产（内容/版本/描述 + git commit）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, content: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, name: { type: 'string' } } } },
  { name: 'asset_types', description: '列出资产类型与目录映射', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_list', description: '列出图谱资产（GRAPH 类型）', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_get', description: '获取一张图谱资产（元数据 + 完整 ARCHGRAPH 图谱）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'graph_validate', description: '校验一张 ARCHGRAPH 图谱（提交前自检）', inputSchema: { type: 'object', required: ['graph'], properties: { graph: { type: 'object' } } } },
  { name: 'graph_submit', description: '提交新图谱资产（schema 校验 + 写入 graphs/<id>/graph.json + catalog + git commit）', inputSchema: { type: 'object', required: ['id', 'graph'], properties: { id: { type: 'string' }, graph: { type: 'object' }, name: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' } } } },
  { name: 'graph_update', description: '更新图谱资产（graph/版本/描述 + schema 校验 + git commit）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, graph: { type: 'object' }, version: { type: 'string' }, description: { type: 'string' }, name: { type: 'string' } } } },
];

const TOOL_HANDLERS = {
  asset_list: toolAssetList,
  asset_get: toolAssetGet,
  asset_search: toolAssetSearch,
  asset_register: toolAssetRegister,
  asset_update: toolAssetUpdate,
  asset_types: toolAssetTypes,
  graph_list: toolGraphList,
  graph_get: toolGraphGet,
  graph_validate: toolGraphValidate,
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
        serverInfo: { name: 'asset-mcp', version: '1.0.0' },
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
    return sendJson(res, 200, { status: 'ok', service: 'asset-mcp' });
  }
  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, {
      service: 'AI 组织资产 MCP HTTP/SSE 服务',
      endpoints: { mcp: 'POST /mcp', health: 'GET /health' },
      assetRoot: ASSET_ROOT,
      assetTypes: ASSET_TYPES,
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
  console.log(`[asset-mcp] listening on http://${HOST}:${PORT}`);
  console.log(`[asset-mcp] asset root: ${ASSET_ROOT}`);
  console.log(`[asset-mcp] git dir: ${GIT_DIR}`);
});
