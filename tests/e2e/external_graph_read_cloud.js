/**
 * End-to-End Acceptance — 跨项目图谱查询（正式云端服务器）
 *
 * 依据规则「端到端云端验收规则」(kb-rule-e2e-cloud-acceptance)：可端到端验证的验收
 * 必须在正式云端服务器上执行。本脚本对生产环境 https://argo.derekworkspacev5.com
 * 运行完整链路并自清理（注册 → 托管 → 未授权拒绝 → 授权 → 读取 → 隔离 → 注销清理）。
 *
 * 用法：node tests/e2e/external_graph_read_cloud.js
 *   E2E_BASE 可覆盖基址（默认 https://argo.derekworkspacev5.com）
 *
 * 注意：会向生产注册中心注册临时成员（e2e-mirror-a/b）并在结束时注销清理；
 * 不纳入架构测试自动套件（避免每次跑测都改动生产数据），按需手动/CI 触发。
 */
const BASE = process.env.E2E_BASE || 'https://argo.derekworkspacev5.com';
const A = 'e2e-mirror-a';
const B = 'e2e-mirror-b';

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); }
}

async function mcp(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await res.json();
  const text = j && j.result && j.result.content && j.result.content[0] && j.result.content[0].text;
  return { httpStatus: res.status, parsed: text ? JSON.parse(text) : null };
}
async function restRead(body) {
  const res = await fetch(`${BASE}/graph/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let j = null; try { j = await res.json(); } catch { /* ignore */ }
  return { httpStatus: res.status, json: j };
}

async function main() {
  for (const id of [A, B]) { try { await mcp('registry_deregister', { id }); } catch { /* idempotent */ } }

  try {
    const regA = await mcp('registry_register', { id: A, name: 'E2E Mirror A', sourceRepo: '/tmp/e2e-mirror-a', openContent: [{ id: 'x', name: 'x', ref: 'r' }] });
    check(regA.parsed && regA.parsed.status === 'ok' && regA.parsed.member && regA.parsed.member.id === A, 'cloud register A -> ok');
    const regB = await mcp('registry_register', { id: B, name: 'E2E Mirror B', sourceRepo: '/tmp/e2e-mirror-b' });
    check(regB.parsed && regB.parsed.status === 'ok', 'cloud register B -> ok');

    const syncA = await mcp('mirror_sync', { projectId: A });
    check(syncA.parsed && syncA.parsed.synced === true && syncA.parsed.namespaceKey === `proj:${A}`, 'cloud mirror_sync A -> synced, namespace proj:A');
    const syncB = await mcp('mirror_sync', { projectId: B });
    check(syncB.parsed && syncB.parsed.synced === true, 'cloud mirror_sync B -> synced');

    const denied = await restRead({ requester: B, projectId: A, op: 'elements' });
    check(denied.httpStatus === 403 && denied.json && denied.json.status === 'denied' && denied.json.reason === 'not_authorized', 'cloud REST read (unauthorized) -> 403 denied/not_authorized');

    const auth = await mcp('registry_authorize', { grantor: A, grantee: B, contentId: '*' });
    check(auth.parsed && auth.parsed.status === 'ok', 'cloud authorize A->B -> ok');

    const okRead = await restRead({ requester: B, projectId: A, op: 'elements' });
    check(okRead.httpStatus === 200 && okRead.json && okRead.json.status === 'ok', 'cloud REST read (authorized) -> 200 ok');
    const els = (okRead.json && okRead.json.result && okRead.json.result.elements) || [];
    check(els.some((e) => e.id === 'e2e-a-core'), 'cloud read returns A element e2e-a-core');
    check(!!(okRead.json && okRead.json.version) && okRead.json.namespaceKey === `proj:${A}`, 'cloud read returns version + namespace proj:A');

    const search = await restRead({ requester: B, projectId: A, op: 'search', text: '核心服务' });
    check(search.httpStatus === 200 && search.json.status === 'ok' && (search.json.result.results || []).some((r) => r.id === 'e2e-a-core'), 'cloud vectorized search hits e2e-a-core');

    await mcp('registry_authorize', { grantor: B, grantee: A, contentId: '*' });
    const bRead = await restRead({ requester: A, projectId: B, op: 'elements' });
    const bIds = ((bRead.json && bRead.json.result && bRead.json.result.elements) || []).map((e) => e.id);
    check(bIds.includes('e2e-b-core') && !bIds.includes('e2e-a-core'), 'cloud namespace isolation: read B has only B elements');
  } finally {
    const dA = await mcp('registry_deregister', { id: A });
    const dB = await mcp('registry_deregister', { id: B });
    check(dA.parsed && dA.parsed.mirror && dA.parsed.mirror.removed === true, 'cleanup: deregister A removed mirror');
    check(dB.parsed && dB.parsed.status === 'ok', 'cleanup: deregister B ok');
    const after = await restRead({ requester: B, projectId: A, op: 'overview' });
    check(after.httpStatus === 403 && after.json.reason === 'member_not_found', 'cleanup: read A -> member_not_found');
  }

  if (failures) { console.error(`\nCLOUD E2E: ${failures} FAILED (${BASE})`); process.exit(1); }
  console.log(`\nCLOUD E2E: ALL PASSED (${BASE})`);
}

main().catch((e) => { console.error(`E2E ERROR: ${e && e.stack ? e.stack : e}`); process.exit(1); });
