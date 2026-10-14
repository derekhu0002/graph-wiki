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
const engineClient = require('./mirror-engine-client.js');
const { validateGraph } = require('./graph-schema.js');
const {
  validateSchemaBundle,
  SCHEMA_BASENAME,
  CONFIG_BASENAME,
  RULES_BASENAME,
  GUIDE_BASENAME,
} = require('./ontology-schema.js');
const obs = require('./obs.js');

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
// Ontologies are a SEPARATE asset class from graphs/subgraphs: a schema bundle
// (the type system + rules), not a set of elements. Stored under assets/ontologies/
// with its own index, so the two concepts never share a namespace.
const ONTOLOGIES_DIR = path.join(ASSET_ROOT, 'ontologies');
const ONTOLOGY_CATALOG_PATH = path.join(ONTOLOGIES_DIR, 'catalog.json');
const REGISTRY_PATH = path.join(ASSET_ROOT, 'registry', 'registry.json');

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
    execFileSync('git', ['-C', GIT_DIR, '-c', 'user.name=graph-store', '-c', 'user.email=graph-store@localhost', 'commit', '-m', message], { stdio: 'pipe' });
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
// schema 解析优先级：显式传入 > 图自述 > 框架（镜像引擎按 projectId 解析）> 开放模式（仅结构校验）。

async function resolveValidationSchema(graph, args) {
  const explicit = args && args.schema;
  if (explicit && typeof explicit === 'object') {
    return { schema: { source: 'request', ...explicit }, source: 'request' };
  }
  if (graph && graph.schema && typeof graph.schema === 'object') {
    return { schema: { source: 'declared', ...graph.schema }, source: 'declared' };
  }
  const projectId = args && (args.projectId || args.sourceProjectId);
  if (projectId) {
    const r = await engineClient.getSchema({ projectId: String(projectId) });
    if (r && r.json && r.json.status === 'ok' && r.json.schema) {
      return { schema: { ...r.json.schema, source: 'engine' }, source: 'engine' };
    }
    return { schema: null, source: 'engine_unavailable', engineStatus: r && r.json ? (r.json.status || 'unavailable') : 'unavailable' };
  }
  return { schema: null, source: 'open' };
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

// ---------- 本体（schema bundle）资产读写 ----------
// 本体 = 类型体系 + 校验规则（schema bundle），与图谱（elements/relationships/views）不同。
// 独立存放于 assets/ontologies/<id>/，独立索引 assets/ontologies/catalog.json。

function safeBundleName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s || s === '.' || s === '..' || s.includes('/') || s.includes('\\')) return null;
  return s;
}

function loadOntologyCatalog() {
  if (!fs.existsSync(ONTOLOGY_CATALOG_PATH)) {
    return { schemaVersion: '1.0', lastUpdated: new Date().toISOString().slice(0, 10), ontologies: [] };
  }
  try {
    const c = JSON.parse(fs.readFileSync(ONTOLOGY_CATALOG_PATH, 'utf8'));
    if (!Array.isArray(c.ontologies)) c.ontologies = [];
    return c;
  } catch {
    return { schemaVersion: '1.0', lastUpdated: new Date().toISOString().slice(0, 10), ontologies: [] };
  }
}

function saveOntologyCatalog(catalog) {
  catalog.lastUpdated = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(ONTOLOGIES_DIR, { recursive: true });
  fs.writeFileSync(ONTOLOGY_CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

function ontologyRelDir(id) {
  return path.posix.join('ontologies', id);
}

function ontologyAbsDir(id) {
  return path.join(ONTOLOGIES_DIR, id);
}

function listOntologyEntries() {
  const catalog = loadOntologyCatalog();
  const reg = registry.load(REGISTRY_PATH);
  const counts = new Map();
  for (const m of (reg.members || [])) {
    if (m.status === 'active' && m.ontology) counts.set(m.ontology, (counts.get(m.ontology) || 0) + 1);
  }
  return (catalog.ontologies || []).map((o) => ({
    id: o.id,
    name: o.name,
    version: o.version,
    sourceRepo: o.sourceRepo,
    sourceCommit: o.sourceCommit,
    description: o.description,
    bundle: o.bundle,
    placeholder: !!o.placeholder,
    projectCount: counts.get(o.id) || 0,
  }));
}

function findOntologyEntry(id) {
  const catalog = loadOntologyCatalog();
  return (catalog.ontologies || []).find((o) => o.id === id);
}

// Collect the bundle files from either a `bundle` object (filename -> content)
// or explicit schema/config/rules/guide args. Only safe basenames are kept.
function collectBundleFiles(args) {
  const files = {};
  const a = args || {};
  const bundle = a.bundle || a.files;
  if (bundle && typeof bundle === 'object' && !Array.isArray(bundle)) {
    for (const [k, v] of Object.entries(bundle)) {
      const n = safeBundleName(k);
      if (n) files[n] = v;
    }
  }
  if (a.schema !== undefined) files[SCHEMA_BASENAME] = a.schema;
  if (a.config !== undefined) files[CONFIG_BASENAME] = a.config;
  if (a.rules !== undefined) files[RULES_BASENAME] = a.rules;
  if (a.guide !== undefined) files[GUIDE_BASENAME] = a.guide;
  return files;
}

function readOntologyFiles(id) {
  const dir = ontologyAbsDir(id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const n = safeBundleName(name);
    if (!n) continue;
    const abs = path.join(dir, n);
    if (!fs.statSync(abs).isFile()) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (n.toLowerCase().endsWith('.json')) {
      try { out[n] = JSON.parse(text); } catch { out[n] = text; }
    } else {
      out[n] = text;
    }
  }
  return out;
}

function writeOntologyFiles(dir, files) {
  const written = [];
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const n = safeBundleName(name);
    if (!n) continue;
    const abs = path.join(dir, n);
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
    fs.writeFileSync(abs, text, 'utf8');
    written.push(abs);
  }
  return written;
}

// 占位本体：项目声明了某个「所基于的本体 id」，但货架上还没有该本体（尚未上传）。
// 在货架上登记一个占位条目，使其详情页可列出基于它的项目；不接受 schema bundle 文件。
function ensureOntologyPlaceholder(id) {
  const catalog = loadOntologyCatalog();
  const existing = (catalog.ontologies || []).find((o) => o.id === id);
  if (existing) return { created: false, id, placeholder: !!existing.placeholder };
  catalog.ontologies.push({
    id,
    name: id,
    version: '',
    path: null,
    sourceRepo: '',
    sourceCommit: '',
    description: '（占位：被项目引用但尚未上传本体定义）',
    placeholder: true,
    bundle: { kind: 'placeholder', elementTypeCount: null, relationshipTypeCount: null, hasRules: false, hasGuide: false },
  });
  saveOntologyCatalog(catalog);
  return { created: true, id, placeholder: true };
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

async function toolGraphSubmit(args) {
  const { id, graph, version, description, name, sourceRepo } = args || {};
  if (!id) throw new Error('缺少 id（图谱资产 id）');
  if (!graph || typeof graph !== 'object') throw new Error('缺少 graph（ARCHGRAPH 图谱对象）');

  // 内部自动 schema 校验，不过拒收；schema 随项目/资产声明动态解析，中心无内置类型清单。
  const startedAt = Date.now();
  const resolved = await resolveValidationSchema(graph, args);
  const validation = validateGraph(graph, resolved.schema);
  obs.append('store', {
    kind: 'graph_validate',
    op: 'submit',
    graphId: id,
    schemaSource: resolved.source,
    engineStatus: resolved.engineStatus,
    valid: validation.valid,
    errorCount: validation.errors.length,
    errors: validation.errors.slice(0, 10),
    durationMs: Date.now() - startedAt,
  });
  if (!validation.valid) {
    return { status: 'failed', reason: 'schema_validation_failed', schemaSource: resolved.source, errors: validation.errors };
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
    validation: { valid: true, errors: [], schemaSource: resolved.source },
    stats: graphStats(graph),
    commit: commitResult,
  };
}

async function toolGraphUpdate(args) {
  const { id, graph, version, description, name } = args || {};
  if (!id) throw new Error('缺少 id');
  const catalog = loadCatalog();
  const entry = (catalog.graphs || []).find((g) => g.id === id);
  if (!entry) throw new Error(`图谱资产未找到: ${id}（用 graph_submit 新建）`);

  const changed = [];
  if (graph != null) {
    if (typeof graph !== 'object') throw new Error('graph 必须是对象');
    // 内部自动 schema 校验，不过拒收；schema 动态解析（显式 > 自述 > 框架引擎 > 开放）。
    const startedAt = Date.now();
    const resolved = await resolveValidationSchema(graph, args);
    const validation = validateGraph(graph, resolved.schema);
    obs.append('store', {
      kind: 'graph_validate',
      op: 'update',
      graphId: id,
      schemaSource: resolved.source,
      engineStatus: resolved.engineStatus,
      valid: validation.valid,
      errorCount: validation.errors.length,
      errors: validation.errors.slice(0, 10),
      durationMs: Date.now() - startedAt,
    });
    if (!validation.valid) {
      return { status: 'failed', reason: 'schema_validation_failed', schemaSource: resolved.source, errors: validation.errors };
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

// ---------- 本体资产工具 ----------

function toolOntologyList() {
  const entries = listOntologyEntries();
  return { status: 'ok', count: entries.length, ontologies: entries };
}

function toolOntologyGet(args) {
  const id = args && args.id;
  if (!id) throw new Error('缺少 id');
  const entry = findOntologyEntry(id);
  if (!entry) throw new Error(`本体资产未找到: ${id}`);
  // 占位本体没有 schema bundle 文件（尚未上传），返回空文件集与关联项目清单。
  const files = readOntologyFiles(id) || {};
  const reg = registry.load(REGISTRY_PATH);
  const members = registry.membersByOntology(reg, id);
  return {
    status: 'ok',
    asset: {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      sourceRepo: entry.sourceRepo,
      sourceCommit: entry.sourceCommit,
      description: entry.description,
      bundle: entry.bundle,
      placeholder: !!entry.placeholder,
    },
    files,
    members,
  };
}

function ontologyBundleSummary(files) {
  return files.map((f) => path.basename(f)).sort();
}

function toolOntologySubmit(args) {
  const { id, name, version, description, sourceRepo } = args || {};
  if (!id) throw new Error('缺少 id（本体资产 id）');
  const files = collectBundleFiles(args);
  if (Object.keys(files).length === 0) {
    throw new Error(`缺少 bundle（schema bundle 文件：${SCHEMA_BASENAME} / ${CONFIG_BASENAME} / ${RULES_BASENAME} / ${GUIDE_BASENAME}）`);
  }

  // 复用 ARGO schema-bundle 契约校验；不通过则拒收不入库。
  const startedAt = Date.now();
  const validation = validateSchemaBundle(files);
  obs.append('store', {
    kind: 'ontology_validate',
    op: 'submit',
    ontologyId: id,
    valid: validation.valid,
    errorCount: validation.errors.length,
    errors: validation.errors.slice(0, 10),
    durationMs: Date.now() - startedAt,
  });
  if (!validation.valid) {
    return { status: 'failed', reason: 'bundle_validation_failed', errors: validation.errors };
  }

  const catalog = loadOntologyCatalog();
  if ((catalog.ontologies || []).some((o) => o.id === id)) {
    throw new Error(`本体资产已存在: ${id}（用 ontology_update 更新）`);
  }

  const written = writeOntologyFiles(ontologyAbsDir(id), files);
  catalog.ontologies.push({
    id,
    name: name || validation.summary.id || id,
    version: version || '1.0.0',
    path: ontologyRelDir(id),
    sourceRepo: sourceRepo || path.basename(REPO_ROOT),
    sourceCommit: 'pending',
    description: description || '',
    bundle: validation.summary,
  });
  saveOntologyCatalog(catalog);

  const commitResult = gitCommit(`feat(ontologies): submit ontology ${id}`, [...written, ONTOLOGY_CATALOG_PATH]);
  if (commitResult.committed) {
    catalog.ontologies.find((o) => o.id === id).sourceCommit = commitResult.commit;
    saveOntologyCatalog(catalog);
  }
  return {
    status: 'ok',
    ontologyId: id,
    validation: { valid: true, errors: [], ...validation.summary },
    files: ontologyBundleSummary(written),
    commit: commitResult,
  };
}

function toolOntologyUpdate(args) {
  const { id, name, version, description, sourceRepo } = args || {};
  if (!id) throw new Error('缺少 id');
  const catalog = loadOntologyCatalog();
  const entry = (catalog.ontologies || []).find((o) => o.id === id);
  if (!entry) throw new Error(`本体资产未找到: ${id}（用 ontology_submit 新建）`);

  const provided = collectBundleFiles(args);
  const changed = [];

  if (Object.keys(provided).length > 0) {
    // Merge with the stored bundle so a partial update still validates against the
    // full contract, then persist only the provided files.
    const existing = readOntologyFiles(id) || {};
    const merged = { ...existing, ...provided };
    const startedAt = Date.now();
    const validation = validateSchemaBundle(merged);
    obs.append('store', {
      kind: 'ontology_validate',
      op: 'update',
      ontologyId: id,
      valid: validation.valid,
      errorCount: validation.errors.length,
      errors: validation.errors.slice(0, 10),
      durationMs: Date.now() - startedAt,
    });
    if (!validation.valid) {
      return { status: 'failed', reason: 'bundle_validation_failed', errors: validation.errors };
    }
    changed.push(...writeOntologyFiles(ontologyAbsDir(id), provided));
    entry.bundle = validation.summary;
  }
  if (version) { entry.version = version; changed.push(ONTOLOGY_CATALOG_PATH); }
  if (description != null) { entry.description = description; changed.push(ONTOLOGY_CATALOG_PATH); }
  if (name) { entry.name = name; changed.push(ONTOLOGY_CATALOG_PATH); }
  if (sourceRepo) { entry.sourceRepo = sourceRepo; changed.push(ONTOLOGY_CATALOG_PATH); }
  const uniqueChanged = [...new Set(changed)];

  if (uniqueChanged.length > 0) saveOntologyCatalog(catalog);
  const commitResult = uniqueChanged.length > 0
    ? gitCommit(`chore(ontologies): update ontology ${id}`, uniqueChanged)
    : { committed: false, reason: 'no changes' };
  if (commitResult.committed) {
    entry.sourceCommit = commitResult.commit;
    saveOntologyCatalog(catalog);
  }
  return { status: 'ok', ontologyId: id, commit: commitResult };
}

// ---------- 联邦注册中心 Registry（P0 只读） ----------

async function toolRegistryRegister(args) {
  const a = args || {};
  // 提交规范：每个项目注册时必须声明它所基于的本体资产 id（连接键）。
  const ontology = String(a.ontology || '').trim();
  if (!ontology) throw new Error('缺少 ontology（项目所基于的本体资产 id；可在货架上，或不在——不在货架将建占位本体）');
  const reg = registry.load(REGISTRY_PATH);
  const member = registry.registerMember(reg, a);
  registry.save(REGISTRY_PATH, reg);
  obs.append('store', { kind: 'registry', op: 'register', memberId: member.id, ontology, sourceRepo: member.sourceRepo, branch: member.branch });
  // 本体归属：声明的本体不在货架 → 建占位本体（货架可见、详情页列项目、标注未上传）。
  const placeholder = ensureOntologyPlaceholder(ontology);
  const files = placeholder.created ? [REGISTRY_PATH, ONTOLOGY_CATALOG_PATH] : [REGISTRY_PATH];
  const commitResult = gitCommit(`feat(registry): register member ${member.id} (ontology ${ontology})`, files);
  // 副本建设：注册后**后台异步**触发（不阻塞本调用；构建耗时长，完成后可经 mirror_list / mirror_sync 查看）。
  let mirrorResult;
  if (member.sourceRepo) {
    engineClient.syncMirror({ projectId: member.id, sourceRepo: member.sourceRepo, branch: member.branch }).catch(() => {});
    mirrorResult = { status: 'accepted', note: 'mirror build started in background; poll mirror_list' };
  } else {
    mirrorResult = { status: 'skipped', reason: 'no_sourceRepo' };
  }
  return { status: 'ok', member: registry.discover(reg).find((m) => m.id === member.id), ontology: placeholder, mirror: mirrorResult, commit: commitResult };
}

async function toolRegistryDeregister(args) {
  const id = args && args.id;
  if (!id) throw new Error('缺少 id');
  const reg = registry.load(REGISTRY_PATH);
  const result = registry.deregisterMember(reg, id);
  registry.save(REGISTRY_PATH, reg);
  obs.append('store', { kind: 'registry', op: 'deregister', memberId: id });
  const removeResult = (await engineClient.removeMirror({ projectId: id })).json;
  const commitResult = gitCommit(`feat(registry): deregister member ${id}`, [REGISTRY_PATH]);
  return { status: 'ok', ...result, mirror: removeResult, commit: commitResult };
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
  obs.append('store', { kind: 'registry', op: 'authorize', grantor: grant.grantor, grantee: grant.grantee, contentId: grant.contentId });
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

function toolRegistryGrants() {
  const reg = registry.load(REGISTRY_PATH);
  const grants = registry.listGrants(reg);
  return { status: 'ok', count: grants.length, grants };
}

// ---------- 跨项目图谱查询（外部图读取）+ 副本托管 ----------

async function toolGraphReadExternal(args) {
  const a = args || {};
  if (!a.requester) throw new Error('缺少 requester（请求方项目 id）');
  if (!a.projectId) throw new Error('缺少 projectId（被查项目 id）');
  if (!a.tool) throw new Error('缺少 tool（ARGO 读工具名）');
  const startedAt = Date.now();
  const finish = (result) => {
    obs.append('store', {
      kind: 'graph_read',
      requester: a.requester,
      projectId: a.projectId,
      tool: a.tool,
      contentId: a.contentId || '*',
      status: result.status,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return result;
  };
  const reg = registry.load(REGISTRY_PATH);
  const member = (reg.members || []).find((m) => m.id === a.projectId && m.status === 'active');
  if (!member) return finish({ status: 'denied', reason: 'member_not_found', requester: a.requester, projectId: a.projectId });
  if (!registry.isAuthorized(reg, a.requester, a.projectId, a.contentId)) {
    return finish({ status: 'denied', reason: 'not_authorized', requester: a.requester, projectId: a.projectId });
  }
  const r = await engineClient.readExternal({ projectId: a.projectId, tool: a.tool, args: a.args || {} });
  if (!r.json || r.json.status === 'unavailable') {
    return finish({ status: 'denied', reason: 'engine_unreachable', requester: a.requester, projectId: a.projectId });
  }
  if (r.json.status !== 'ok') {
    return finish({ status: r.json.status, reason: r.json.reason, requester: a.requester, projectId: a.projectId });
  }
  return finish({ status: 'ok', requester: a.requester, projectId: a.projectId, namespaceKey: `proj:${a.projectId}`, tool: a.tool, result: r.json.result });
}

async function toolMirrorSync(args) {
  const a = args || {};
  if (!a.projectId) throw new Error('缺少 projectId');
  const reg = registry.load(REGISTRY_PATH);
  const member = (reg.members || []).find((m) => m.id === a.projectId && m.status === 'active');
  if (!member) throw new Error(`成员未注册或已注销: ${a.projectId}`);
  const r = await engineClient.syncMirror({
    projectId: a.projectId,
    sourceRepo: a.sourceRepo || member.sourceRepo,
    branch: a.branch || member.branch,
  });
  return r.json || { status: 'unavailable' };
}

async function toolMirrorList() {
  const r = await engineClient.listMirrors();
  return r.json || { status: 'unavailable', count: 0, mirrors: [] };
}

// ---------- MCP 处理 ----------

const TOOLS = [
  { name: 'graph_list', description: '列出图谱资产', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_get', description: '获取一张图谱资产（元数据 + 完整 ARCHGRAPH 图谱）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'graph_submit', description: '提交新图谱资产（内部自动 schema 校验，不通过则拒收不入库；schema 随项目/资产声明动态解析，中心无内置类型清单）', inputSchema: { type: 'object', required: ['id', 'graph'], properties: { id: { type: 'string' }, graph: { type: 'object' }, name: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' }, projectId: { type: 'string' }, schema: { type: 'object' } } } },
  { name: 'graph_update', description: '更新图谱资产（内部自动 schema 校验，不通过则拒收不入库；schema 随项目/资产声明动态解析，中心无内置类型清单）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, graph: { type: 'object' }, version: { type: 'string' }, description: { type: 'string' }, name: { type: 'string' }, projectId: { type: 'string' }, schema: { type: 'object' } } } },
  { name: 'ontology_list', description: '列出本体资产（schema bundle：类型体系 + 校验规则；与图谱/子图不同）', inputSchema: { type: 'object', properties: {} } },
  { name: 'ontology_get', description: '获取一个本体资产（元数据 + 完整 schema bundle 文件）', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'ontology_submit', description: '提交新本体资产（schema bundle；内部复用 ARGO schema-bundle 契约校验：类型枚举 / actor 契约 / rules，不通过则拒收不入库）。bundle 为文件名→内容的映射，或分别用 schema/config/rules/guide 传入。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, bundle: { type: 'object' }, schema: { type: 'object' }, config: { type: 'object' }, rules: { type: 'object' }, guide: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' } } } },
  { name: 'ontology_update', description: '更新本体资产（schema bundle；内部复用 ARGO schema-bundle 契约校验，不通过则拒收不入库）。可只更新部分文件，其余保持。', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, bundle: { type: 'object' }, schema: { type: 'object' }, config: { type: 'object' }, rules: { type: 'object' }, guide: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' }, description: { type: 'string' }, sourceRepo: { type: 'string' } } } },
  { name: 'registry_register', description: '联邦成员自注册到中心（身份/职责/能力/开放内容清单 + 所基于的本体 id ontology，必填）。注册即异步触发一次镜像建设（best-effort）；中心确认 id 全局唯一。ontology 不在货架时自动建占位本体', inputSchema: { type: 'object', required: ['id', 'ontology'], properties: { id: { type: 'string' }, ontology: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, capabilities: { type: 'array' }, openContent: { type: 'array' }, sourceRepo: { type: 'string' }, branch: { type: 'string' } } } },
  { name: 'registry_deregister', description: '联邦成员自注销，注销后 discover 不再可见', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'registry_discover', description: '发现已注册联邦成员的基础信息（它是谁、做什么、有什么能力）', inputSchema: { type: 'object', properties: {} } },
  { name: 'registry_authorize', description: '成员显式授权某请求方读取其对外开放内容；未授权默认拒绝', inputSchema: { type: 'object', required: ['grantor', 'grantee'], properties: { grantor: { type: 'string' }, grantee: { type: 'string' }, contentId: { type: 'string' } } } },
  { name: 'registry_read', description: '授权后读取成员开放内容（返回引用，非副本）；未授权默认拒绝', inputSchema: { type: 'object', required: ['requester', 'member'], properties: { requester: { type: 'string' }, member: { type: 'string' }, contentId: { type: 'string' } } } },
  { name: 'registry_grants', description: '列出全部联邦授权关系（grantor→grantee, contentId, grantedAt），供成员间授权关系展示', inputSchema: { type: 'object', properties: {} } },
  { name: 'graph_read_external', description: '跨项目图谱查询：授权后经镜像引擎（复用 ARGO）按 projectId 查询托管副本；tool 为 ARGO 读工具名（getSystemArchitecture/getIntentElementContext/getArchitectureViewContext/queryNeo4jGraph/memory_search）；未授权默认拒绝', inputSchema: { type: 'object', required: ['requester', 'projectId', 'tool'], properties: { requester: { type: 'string' }, projectId: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' }, contentId: { type: 'string' } } } },
  { name: 'mirror_sync', description: '按成员已审核分支同步其仓到镜像宿主（复用 ARGO：Neo4j 投影 + .qea + embedding），按 git 版本幂等', inputSchema: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' }, sourceRepo: { type: 'string' }, branch: { type: 'string' } } } },
  { name: 'mirror_list', description: '列出镜像宿主已托管的成员副本', inputSchema: { type: 'object', properties: {} } },
];

const TOOL_HANDLERS = {
  graph_list: toolGraphList,
  graph_get: toolGraphGet,
  graph_submit: toolGraphSubmit,
  graph_update: toolGraphUpdate,
  ontology_list: toolOntologyList,
  ontology_get: toolOntologyGet,
  ontology_submit: toolOntologySubmit,
  ontology_update: toolOntologyUpdate,
  registry_register: toolRegistryRegister,
  registry_deregister: toolRegistryDeregister,
  registry_discover: toolRegistryDiscover,
  registry_authorize: toolRegistryAuthorize,
  registry_read: toolRegistryRead,
  registry_grants: toolRegistryGrants,
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
      const result = await handler(args);
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
    const result = await toolGraphReadExternal(body);
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
