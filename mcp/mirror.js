#!/usr/bin/env node
/**
 * 联邦副本托管（Mirror Host）——纯 Node 零依赖。
 *
 * 定位：Graph Store（中心）拥有高权限且始终在线。成员项目把自己的意图图
 * 经 push/merge 审核后开放；中心按项目 ID 下载其仓、完成「投影 + 向量化」，
 * 落到独立命名空间 proj:<projectId>，并按 git 版本幂等同步（版本变了才重建）。
 *
 * 内容主权：成员仓仍是事实源（source of truth），中心保存的是可用性副本
 * （availability replica），只增不写入成员仓。
 *
 * 模块无隐藏 I/O：镜像根目录由调用方显式传入（服务用 assets/mirrors，
 * 测试用临时目录），可被 MCP 服务与验收测试共同复用。
 *
 * 数据布局：
 *   <mirrorRoot>/<projectId>/graph.json   成员图谱快照（ARCHGRAPH）
 *   <mirrorRoot>/<projectId>/meta.json    身份/命名空间/版本/同步时间
 *   <mirrorRoot>/<projectId>/index.json   结构化投影（byId/byType/adjacency/views）
 *   <mirrorRoot>/<projectId>/vectors.json 向量化索引（本地哈希向量，可替换为真实 embedding）
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateGraph } = require('./graph-schema.js');

const VECTOR_DIM = 256;
const DEFAULT_GRAPH_PATH = 'design/KG/SystemArchitecture.json';
const DEFAULT_BRANCH = 'main';

// ---------- 路径 ----------

function namespaceKey(projectId) {
  return `proj:${projectId}`;
}
function mirrorDir(root, projectId) {
  return path.join(root, projectId);
}
function graphFile(root, projectId) {
  return path.join(mirrorDir(root, projectId), 'graph.json');
}
function metaFile(root, projectId) {
  return path.join(mirrorDir(root, projectId), 'meta.json');
}
function indexFile(root, projectId) {
  return path.join(mirrorDir(root, projectId), 'index.json');
}
function vectorsFile(root, projectId) {
  return path.join(mirrorDir(root, projectId), 'vectors.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// ---------- 投影（结构化索引） ----------

function project(graph) {
  const byId = {};
  const byType = {};
  const adjacency = {};
  for (const e of graph.elements || []) {
    byId[e.id] = { id: e.id, name: e.name, type: e.type, description: e.description || '' };
    (byType[e.type] = byType[e.type] || []).push(e.id);
    adjacency[e.id] = adjacency[e.id] || [];
  }
  for (const r of graph.relationships || []) {
    (adjacency[r.source_id] = adjacency[r.source_id] || []).push({
      relId: r.id, type: r.type, dir: 'out', other: r.target_id, name: r.name || '',
    });
    (adjacency[r.target_id] = adjacency[r.target_id] || []).push({
      relId: r.id, type: r.type, dir: 'in', other: r.source_id, name: r.name || '',
    });
  }
  const views = (graph.views || []).map((v) => ({
    view_id: v.view_id,
    view_name: v.view_name,
    parent_element_id: v.parent_element_id || null,
    members: v.included_elements || [],
  }));
  return { byId, byType, adjacency, views };
}

// ---------- 向量化（本地哈希向量） ----------
// 纯 Node 零依赖的可插拔向量化：英文/数字按词、中文按「单字 + 相邻二元组」取特征，
// 哈希到固定维度并 L2 归一化，余弦相似度检索。后续可替换为真实 embedding 服务，
// 只需保持 vectors.json 的形状（id -> number[]）。

function features(text) {
  const s = String(text || '').toLowerCase();
  const feats = [];
  for (const m of s.matchAll(/[a-z0-9_]+/g)) feats.push(m[0]);
  const cjk = [...s].filter((c) => /[\u4e00-\u9fff]/.test(c));
  for (let i = 0; i < cjk.length; i += 1) {
    feats.push(cjk[i]);
    if (i + 1 < cjk.length) feats.push(cjk[i] + cjk[i + 1]);
  }
  return feats;
}
function hashIndex(token) {
  const h = crypto.createHash('md5').update(token).digest();
  return h.readUInt32BE(0) % VECTOR_DIM;
}
function embedText(text) {
  const vec = new Array(VECTOR_DIM).fill(0);
  for (const f of features(text)) vec[hashIndex(f)] += 1;
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm);
  return norm === 0 ? vec : vec.map((x) => x / norm);
}
function embed(graph) {
  const vectors = {};
  for (const e of graph.elements || []) {
    vectors[e.id] = embedText(`${e.name || ''} ${e.type || ''} ${e.description || ''}`);
  }
  return vectors;
}
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

// ---------- 写入 / 同步 ----------

function stats(graph) {
  return {
    elements: (graph.elements || []).length,
    relationships: (graph.relationships || []).length,
    views: (graph.views || []).length,
  };
}

function ingest(root, projectId, payload) {
  const graph = payload && payload.graph;
  const validation = validateGraph(graph);
  if (!validation.valid) {
    const err = new Error(`镜像图谱 schema 校验失败: ${projectId}`);
    err.code = 'schema_validation_failed';
    err.errors = validation.errors;
    throw err;
  }
  const meta = {
    schemaVersion: '1.0',
    projectId,
    namespaceKey: namespaceKey(projectId),
    name: (payload && payload.name) || graph.name || projectId,
    sourceRepo: (payload && payload.sourceRepo) || '',
    branch: (payload && payload.branch) || DEFAULT_BRANCH,
    graphPath: (payload && payload.graphPath) || DEFAULT_GRAPH_PATH,
    commit: (payload && payload.commit) || 'unversioned',
    syncedAt: new Date().toISOString(),
    stats: stats(graph),
  };
  writeJson(graphFile(root, projectId), graph);
  writeJson(indexFile(root, projectId), project(graph));
  writeJson(vectorsFile(root, projectId), embed(graph));
  writeJson(metaFile(root, projectId), meta);
  return { synced: true, mirrored: true, ...meta };
}

function gitRevParse(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * 同步成员副本。sourceRepo 为本地目录时直接读；为远程 URL 时用 git 拉取到 <root>/.cache。
 * 以 commit 为版本：版本未变则跳过（幂等），变了则重新投影 + 重新向量化。
 */
function sync(root, projectId, options) {
  const opts = options || {};
  const existing = getMeta(root, projectId);
  const sourceRepo = opts.sourceRepo || (existing && existing.sourceRepo);
  if (!sourceRepo) throw new Error(`缺少 sourceRepo（成员 ${projectId} 未登记来源仓）`);
  const branch = opts.branch || (existing && existing.branch) || DEFAULT_BRANCH;
  const graphPath = opts.graphPath || (existing && existing.graphPath) || DEFAULT_GRAPH_PATH;

  const isLocalDir = fs.existsSync(sourceRepo) && fs.statSync(sourceRepo).isDirectory();
  let repoDir = sourceRepo;
  if (!isLocalDir) {
    const cacheDir = path.join(root, '.cache', projectId);
    if (!fs.existsSync(path.join(cacheDir, '.git'))) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
      execFileSync('git', ['clone', '--depth', '1', '--branch', branch, sourceRepo, cacheDir], { stdio: 'pipe' });
    } else {
      execFileSync('git', ['-C', cacheDir, 'fetch', '--depth', '1', 'origin', branch], { stdio: 'pipe' });
      execFileSync('git', ['-C', cacheDir, 'reset', '--hard', `origin/${branch}`], { stdio: 'pipe' });
    }
    repoDir = cacheDir;
  }

  const graphAbs = path.join(repoDir, graphPath);
  if (!fs.existsSync(graphAbs)) throw new Error(`来源图谱不存在: ${graphAbs}`);
  const graph = readJson(graphAbs);
  if (!graph) throw new Error(`来源图谱无法解析: ${graphAbs}`);
  const commit = opts.commit || gitRevParse(repoDir) || 'unversioned';

  if (existing && existing.commit === commit && exists(root, projectId)) {
    return { synced: false, reason: 'up-to-date', projectId, commit, namespaceKey: namespaceKey(projectId) };
  }
  const result = ingest(root, projectId, { graph, sourceRepo, branch, graphPath, commit });
  return { synced: true, reason: existing ? 'updated' : 'created', ...result };
}

// ---------- 读取 ----------

function exists(root, projectId) {
  return fs.existsSync(graphFile(root, projectId)) && fs.existsSync(indexFile(root, projectId));
}
function getMeta(root, projectId) {
  return readJson(metaFile(root, projectId));
}
function readGraph(root, projectId) {
  return readJson(graphFile(root, projectId));
}
function list(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '.cache')
    .map((d) => getMeta(root, d.name))
    .filter(Boolean);
}
function remove(root, projectId) {
  const dir = mirrorDir(root, projectId);
  if (!fs.existsSync(dir)) return { removed: false, projectId };
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true, projectId };
}

function summarize(byId, id) {
  return byId[id] || { id, name: id, type: 'unknown', description: '' };
}

/** 在某个副本命名空间内执行只读查询。op：overview|elements|element|neighbors|views|search */
function query(root, projectId, q) {
  const query0 = q || {};
  const index = readJson(indexFile(root, projectId));
  const vectors = readJson(vectorsFile(root, projectId)) || {};
  if (!index) return { status: 'not_found', reason: 'mirror_not_synced', projectId };

  switch (query0.op) {
    case 'overview':
      return { op: 'overview', stats: { elements: Object.keys(index.byId).length, byType: Object.keys(index.byType).length, views: index.views.length } };
    case 'elements': {
      let ids = Object.keys(index.byId);
      if (query0.type) ids = ids.filter((id) => index.byId[id].type === query0.type);
      const elements = ids.map((id) => summarize(index.byId, id));
      return { op: 'elements', count: elements.length, elements };
    }
    case 'element': {
      if (!query0.id) return { status: 'bad_request', reason: 'missing_id' };
      const element = index.byId[query0.id];
      if (!element) return { status: 'not_found', reason: 'element_not_found', id: query0.id };
      return { op: 'element', element, relationships: index.adjacency[query0.id] || [] };
    }
    case 'neighbors': {
      if (!query0.id) return { status: 'bad_request', reason: 'missing_id' };
      const depth = Number.isFinite(query0.depth) ? query0.depth : 1;
      const seen = new Set([query0.id]);
      const frontier = [query0.id];
      const edges = [];
      for (let d = 0; d < depth; d += 1) {
        const next = [];
        for (const id of frontier) {
          for (const edge of index.adjacency[id] || []) {
            edges.push({ from: id, ...edge });
            if (!seen.has(edge.other)) { seen.add(edge.other); next.push(edge.other); }
          }
        }
        frontier.length = 0;
        frontier.push(...next);
      }
      return { op: 'neighbors', root: query0.id, depth, nodes: [...seen].map((id) => summarize(index.byId, id)), edges };
    }
    case 'views':
      return { op: 'views', count: index.views.length, views: index.views };
    case 'search': {
      const text = String(query0.text || '').trim();
      const limit = Number.isFinite(query0.limit) ? query0.limit : 10;
      if (!text) return { status: 'bad_request', reason: 'missing_text' };
      const qv = embedText(text);
      const scored = Object.keys(index.byId).map((id) => {
        const v = vectors[id] || [];
        return { id, score: v.length ? cosine(qv, v) : 0 };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
      return { op: 'search', text, count: scored.length, results: scored.map((x) => ({ ...summarize(index.byId, x.id), score: Number(x.score.toFixed(4)) })) };
    }
    default:
      return { status: 'bad_request', reason: `unknown_op:${query0.op}` };
  }
}

module.exports = {
  VECTOR_DIM,
  DEFAULT_GRAPH_PATH,
  DEFAULT_BRANCH,
  namespaceKey,
  project,
  embed,
  embedText,
  ingest,
  sync,
  exists,
  getMeta,
  readGraph,
  list,
  remove,
  query,
  mirrorDir,
};
