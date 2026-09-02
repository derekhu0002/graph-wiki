/**
 * Acceptance Test - 总知识图谱 ARGO MCP HTTP/SSE 网关可运行性
 *
 * External-view acceptance:
 *
 * GIVEN ARGO MCP HTTP/SSE 网关已启动（http://127.0.0.1:<port>）
 * WHEN 通过 HTTP 调用网关的 MCP 端点（initialize / tools/list / tools/call）
 * THEN
 *   1. GET /health 返回 status=ok
 *   2. POST /mcp initialize 返回 protocolVersion 2024-11-05 且 serverInfo.name=argo
 *   3. POST /mcp tools/list 返回含 getSystemArchitecture 的工具集
 *   4. POST /mcp tools/call getSystemArchitecture(query) 成功返回图谱查询结果
 */
const http = require('node:http');

const PORT = Number(process.env.KG_MCP_PORT || 18789);
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  // THEN 1: 健康检查
  const health = await request('GET', '/health');
  if (health.status !== 200 || health.body.status !== 'ok') {
    fail(`health check failed: ${health.status} ${JSON.stringify(health.body)}`);
  }

  // THEN 2: MCP 握手
  const init = await request('POST', '/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'acceptance-test', version: '1.0' },
    },
  });
  if (
    init.status !== 200 ||
    !init.body ||
    !init.body.result ||
    init.body.result.serverInfo.name !== 'argo' ||
    init.body.result.protocolVersion !== '2024-11-05'
  ) {
    fail(`MCP initialize failed: ${JSON.stringify(init.body)}`);
  }

  // THEN 3: 工具列表包含 getSystemArchitecture
  const tools = await request('POST', '/mcp', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  const toolNames = (tools.body && tools.body.result && tools.body.result.tools || []).map(
    (t) => t.name
  );
  if (!toolNames.includes('getSystemArchitecture') || !toolNames.includes('queryNeo4jGraph')) {
    fail(`tools/list missing required tools: ${toolNames.join(', ')}`);
  }

  // THEN 4: 实际语义查询
  const query = await request('POST', '/mcp', {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'getSystemArchitecture',
      arguments: {
        query: { purpose: 'general', intent: 'find the master knowledge graph service architecture' },
      },
    },
  });
  if (
    query.status !== 200 ||
    !query.body ||
    !query.body.result ||
    !query.body.result.content ||
    !query.body.result.content[0] ||
    !query.body.result.content[0].text
  ) {
    fail(`tools/call getSystemArchitecture failed: ${JSON.stringify(query.body)}`);
  }
  const text = query.body.result.content[0].text;
  if (!text.includes('总知识图谱') && !text.includes('kg-service')) {
    fail(`semantic query result does not mention master knowledge graph service`);
  }

  console.log(
    `PASS: ARGO MCP HTTP/SSE gateway at ${BASE} is healthy, handshakes as argo ` +
      `(protocol ${init.body.result.protocolVersion}), exposes ${toolNames.length} tools ` +
      `(incl. getSystemArchitecture/queryNeo4jGraph), and executes semantic queries.`
  );
}

main().catch((error) => {
  fail(error.message);
});
