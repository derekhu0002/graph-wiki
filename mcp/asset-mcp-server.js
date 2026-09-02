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
 *
 * 变更入口唯一化：所有资产变更必须通过 asset_register / asset_update（内部自动 git commit），
 * 不允许外部直接写 assets/ 文件后手动提交。
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

const ASSET_TYPES = ['AGENT', 'SKILL', 'RULE', 'HOOKS', 'KNOWLEDGE'];
const TYPE_DIRS = {
  AGENT: 'agents',
  SKILL: 'skills',
  RULE: 'rules',
  HOOKS: 'hooks',
  KNOWLEDGE: 'knowledge',
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
    return { type: 'dir', files };
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

// ---------- MCP 处理 ----------

const TOOLS = [
  { name: 'asset_list', description: '列出 AI 组织资产（可按 type 过滤）', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ASSET_TYPES } } } },
  { name: 'asset_get', description: '获取单个资产（元数据 + 内容）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'asset_search', description: '关键词搜索资产', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } },
  { name: 'asset_register', description: '登记/提交新资产（写入分类目录 + 更新 catalog.json + git commit）', inputSchema: { type: 'object', required: ['id', 'type', 'content'], properties: { id: { type: 'string' }, type: { type: 'string', enum: ASSET_TYPES }, name: { type: 'string' }, content: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' } } } },
  { name: 'asset_update', description: '更新资产（内容/版本/描述 + git commit）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, content: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, name: { type: 'string' } } } },
  { name: 'asset_types', description: '列出资产类型与目录映射', inputSchema: { type: 'object', properties: {} } },
];

const TOOL_HANDLERS = {
  asset_list: toolAssetList,
  asset_get: toolAssetGet,
  asset_search: toolAssetSearch,
  asset_register: toolAssetRegister,
  asset_update: toolAssetUpdate,
  asset_types: toolAssetTypes,
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
