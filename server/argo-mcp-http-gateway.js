#!/usr/bin/env node
/**
 * ARGO MCP HTTP/SSE Gateway — 将 ARGO MCP server (stdio) 包装为远端 HTTP/SSE 服务。
 *
 * 实现 MCP Streamable HTTP 传输（protocol 2024-11-05 / 2025-03-26 兼容）：
 *   - POST /mcp  : 接收 JSON-RPC 请求，支持 application/json 与 text/event-stream 响应
 *   - GET  /health : 健康检查
 *   - GET  /        : 服务信息
 *
 * 复用 argo-mcp-server.js 的 handleRequest 处理全部 MCP 方法（tools/list,
 * tools/call, initialize, ping, notifications）。
 *
 * 环境变量：
 *   KG_MCP_PORT      监听端口（默认 18789）
 *   KG_MCP_HOST      监听地址（默认 127.0.0.1）
 *   ARGO_REPO_ROOT   总知识图谱工作区根（默认 ./design/KG/SystemArchitecture.json 所在仓库根）
 *   ARGO_ENV_FILE    Argo 环境文件（默认 ~/.argo/.env）
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// ARGO 工具链根：优先取 KG_ARGO_ROOT，否则基于本文件位置向上查找
function resolveArgoRoot() {
  if (process.env.KG_ARGO_ROOT && String(process.env.KG_ARGO_ROOT).trim() !== '') {
    return path.resolve(process.env.KG_ARGO_ROOT);
  }
  let dir = __dirname;
  while (true) {
    const marker = path.join(dir, 'scripts', 'argo-mcp-server.js');
    if (fs.existsSync(marker)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

const ARGO_ROOT = resolveArgoRoot();
if (!ARGO_ROOT) {
  console.error('[argo-mcp-gateway] 无法定位 ARGO 工具链 (scripts/argo-mcp-server.js)。');
  console.error('[argo-mcp-gateway] 请设置 KG_ARGO_ROOT=/path/to/.argo');
  process.exit(1);
}

const argoMcp = require(path.join(ARGO_ROOT, 'scripts', 'argo-mcp-server.js'));
const { loadRepositoryArgoEnvironment } = require(path.join(ARGO_ROOT, 'scripts', 'repositoryArgoEnvironment.js'));

const PORT = Number(process.env.KG_MCP_PORT || 18789);
const HOST = process.env.KG_MCP_HOST || '127.0.0.1';

function resolveRepositoryRoot() {
  if (process.env.ARGO_REPO_ROOT && String(process.env.ARGO_REPO_ROOT).trim() !== '') {
    return path.resolve(process.env.ARGO_REPO_ROOT);
  }
  // 从当前文件位置向上查找 design/KG/SystemArchitecture.json
  let dir = __dirname;
  while (true) {
    const marker = path.join(dir, 'design', 'KG', 'SystemArchitecture.json');
    if (fs.existsSync(marker)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return process.cwd();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : null);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendSse(res, payload) {
  const body = JSON.stringify(payload);
  res.write(`data: ${body}\n\n`);
}

async function handleMcpRequest(req, res) {
  let request;
  try {
    request = await readBody(req);
  } catch (error) {
    return sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: ' + error.message },
    });
  }
  if (!request || typeof request !== 'object' || !request.method) {
    return sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    });
  }

  // 从仓库环境加载 ARGO 配置（Neo4j / embedding）
  try {
    loadRepositoryArgoEnvironment(resolveRepositoryRoot());
  } catch (error) {
    // 环境加载失败不阻断请求，交由具体工具报错
  }

  const response = await argoMcp.handleRequest(request);

  // 客户端接受 SSE 流式响应
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/event-stream')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    sendSse(res, response || {});
    res.end();
    return;
  }

  if (!response) {
    return sendJson(res, 202, {});
  }
  sendJson(res, 200, response);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'argo-mcp-http-gateway' });
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, {
      service: 'ARGO MCP HTTP/SSE Gateway',
      endpoints: { mcp: 'POST /mcp', health: 'GET /health' },
      repositoryRoot: resolveRepositoryRoot(),
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
  console.log(`[argo-mcp-gateway] listening on http://${HOST}:${PORT}`);
  console.log(`[argo-mcp-gateway] repository root: ${resolveRepositoryRoot()}`);
});
