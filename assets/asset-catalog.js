#!/usr/bin/env node
/**
 * AI 组织资产目录 CLI
 *
 * 通过总知识图谱远端服务（ARGO MCP HTTP/SSE 网关）对组织资产目录进行操作：
 *   - list    列出资产目录中的组织资产（可按类型过滤）
 *   - get     查看单个资产元数据
 *   - register 登记一个新资产（图谱仅存目录+元数据，资产本体留在贡献项目仓库）
 *   - update  更新资产元数据（版本/描述/来源commit 等）
 *
 * 资产类型: AGENT | SKILL | RULE | HOOKS | KNOWLEDGE
 *
 * 用法:
 *   node assets/asset-catalog.js list [--type SKILL]
 *   node assets/asset-catalog.js get <assetId>
 *   node assets/asset-catalog.js register <assetId> --type SKILL --name "..." --version 1.0.0 --repo "D:/Projects/foo" --commit abc123 --path "skills/foo.md" --desc "..."
 *   node assets/asset-catalog.js update <assetId> --version 1.1.0 --commit abc456
 *
 * 配置:
 *   KG_MCP_URL   总知识图谱远端服务地址（默认 https://argo.derekworkspacev5.com/mcp）
 *   KG_MCP_INSECURE 设为 1 跳过 TLS 校验（自签名证书时）
 */
const https = require('node:https');
const http = require('node:http');
const url = require('node:url');

const MCP_URL = process.env.KG_MCP_URL || 'https://argo.derekworkspacev5.com/mcp';
const INSECURE = process.env.KG_MCP_INSECURE === '1';

const ASSET_TYPES = ['AGENT', 'SKILL', 'RULE', 'HOOKS', 'KNOWLEDGE'];
const CATALOG_VIEW_ID = 'org-asset-catalog-view';

function rpcRequest(method, params, id = Date.now()) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const target = new url.URL(MCP_URL);
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname || '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        rejectUnauthorized: !INSECURE,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            const json = JSON.parse(text);
            if (json.error) return reject(new Error(json.error.message));
            resolve(json.result);
          } catch (e) {
            reject(new Error('响应解析失败: ' + e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractToolResult(rpcResult) {
  if (!rpcResult || !rpcResult.content || !rpcResult.content[0]) {
    throw new Error('MCP 工具无返回内容');
  }
  const text = rpcResult.content[0].text;
  return JSON.parse(text);
}

async function callTool(name, args) {
  const rpc = await rpcRequest('tools/call', { name, arguments: args || {} });
  return extractToolResult(rpc);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function normalizeType(type) {
  const t = String(type || '').toUpperCase();
  if (!ASSET_TYPES.includes(t)) {
    throw new Error(`非法资产类型: ${type}。合法类型: ${ASSET_TYPES.join(', ')}`);
  }
  return t;
}

function buildAssetId(kind, name) {
  const safeKind = String(kind).toLowerCase();
  const safeName = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `org-asset-${safeKind}-${safeName}`;
}

function extractAssetMeta(element) {
  const attrs = {};
  for (const a of element.attributes || []) {
    attrs[a.name] = a.value;
  }
  return {
    id: element.id,
    name: element.name,
    type: element.type,
    assetType: attrs.assetType,
    version: attrs.version,
    sourceRepo: attrs.sourceRepo,
    sourceCommit: attrs.sourceCommit,
    assetPath: attrs.assetPath,
    description: element.description,
  };
}

async function cmdList(args) {
  const typeFilter = args.type ? normalizeType(args.type) : null;
  const result = await callTool('getArchitectureViewContext', { view_id: CATALOG_VIEW_ID });
  const view = result && (result.view || result.subgraph && result.subgraph.views && result.subgraph.views[0]);
  const elements = (result.elements || result.subgraph && result.subgraph.elements || []);

  // 只展示资产登记元素：目录元素(org-asset-catalog) + 资产元素(id 前缀 org-asset-)，排除关联的项目/图谱节点
  const assets = elements.filter(
    (e) => e.id.startsWith('org-asset-') && e.id !== 'org-asset-catalog'
  );

  const rows = assets
    .map((e) => extractAssetMeta(e))
    .filter((a) => !typeFilter || a.assetType === typeFilter)
    .map((a) => ({ id: a.id, name: a.name, assetType: a.assetType, version: a.version, repo: a.sourceRepo, commit: a.sourceCommit }));

  console.log(JSON.stringify({ status: 'ok', count: rows.length, assets: rows }, null, 2));
}

async function cmdGet(args) {
  const assetId = args._[1];
  if (!assetId) throw new Error('缺少 assetId');
  const result = await callTool('getIntentElementContext', { elementId: assetId, dependencyDepth: 0, dependentDepth: 0 });
  const subgraph = result && result.subgraph;
  const elements = (subgraph && subgraph.elements) || [];
  const focus = elements.find((e) => e.id === assetId) || elements[0];
  if (!focus) throw new Error(`资产未找到: ${assetId}`);
  console.log(JSON.stringify({ status: 'ok', asset: extractAssetMeta(focus) }, null, 2));
}

async function cmdRegister(args) {
  const assetId = args._[1];
  if (!assetId) throw new Error('缺少 assetId');
  const type = normalizeType(args.type);
  const name = args.name || assetId;
  if (!args.version) throw new Error('缺少 --version（资产版本号）');
  if (!args.repo) throw new Error('缺少 --repo（来源项目仓库路径）');
  if (!args.commit) throw new Error('缺少 --commit（来源 commit）');

  const element = {
    id: assetId,
    name,
    type: type === 'RULE' ? 'Rule' : type === 'KNOWLEDGE' ? 'Business Object' : 'Artifact',
    description: args.desc || `${type} 类组织资产：${name}。登记于 AI 组织资产目录，资产本体位于 ${args.repo}（${args.path || '/'}）。`,
  };
  const attributes = [
    { name: 'assetType', value: type },
    { name: 'version', value: args.version },
    { name: 'sourceRepo', value: args.repo },
    { name: 'sourceCommit', value: args.commit },
  ];
  if (args.path) attributes.push({ name: 'assetPath', value: args.path });

  const result = await callTool('addArchitectureElement', { element, view_ids: [CATALOG_VIEW_ID] });
  if (result.status !== 'passed') throw new Error(`登记失败: ${JSON.stringify(result)}`);

  // 登记 commit 元数据
  try {
    await callTool('updateArchitectureElement', { id: assetId, patch: { attributes } });
  } catch (e) {
    // 若元素创建时已带属性则跳过
  }
  console.log(JSON.stringify({ status: 'ok', assetId, message: `已登记资产 ${assetId}` }, null, 2));
}

async function cmdUpdate(args) {
  const assetId = args._[1];
  if (!assetId) throw new Error('缺少 assetId');
  const patch = { attributes: [] };
  if (args.version) patch.attributes.push({ name: 'version', value: args.version });
  if (args.commit) patch.attributes.push({ name: 'sourceCommit', value: args.commit });
  if (args.desc) patch.description = args.desc;
  if (patch.attributes.length === 0 && !args.desc) throw new Error('无可更新字段（--version/--commit/--desc）');
  const result = await callTool('updateArchitectureElement', { id: assetId, patch });
  if (result.status !== 'passed') throw new Error(`更新失败: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ status: 'ok', assetId, message: `已更新资产 ${assetId}` }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command) {
    console.error('用法: node assets/asset-catalog.js <list|get|register|update> [...]');
    console.error('      list [--type AGENT|SKILL|RULE|HOOKS|KNOWLEDGE]');
    console.error('      get <assetId>');
    console.error('      register <assetId> --type X --name N --version V --repo R --commit C [--path P] [--desc D]');
    console.error('      update <assetId> [--version V] [--commit C] [--desc D]');
    process.exit(1);
  }
  try {
    if (command === 'list') await cmdList(args);
    else if (command === 'get') await cmdGet(args);
    else if (command === 'register') await cmdRegister(args);
    else if (command === 'update') await cmdUpdate(args);
    else throw new Error(`未知命令: ${command}`);
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ASSET_TYPES, normalizeType, buildAssetId };
