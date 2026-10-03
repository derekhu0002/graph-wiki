/**
 * Acceptance Test - 镜像引擎可观测性（打点 + 健康/巡检元数据 + schema 端点韧性）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一个隔离的 ARGO_ROOT（含版本）+ MIRRORS_ROOT（含成员副本与 meta）+ 日志目录
 * WHEN 启动 ARGO 镜像引擎并调用 /health、/mirrors、/schema
 * THEN
 *   1. /health 返回 ok、argoVersion、logDir（框架版本可观测）
 *   2. /mirrors 暴露 commit/syncedAt/neo4jOk/semanticOk（巡检与漂移检测所需）
 *   3. /schema 对未同步成员返回 403 mirror_not_synced
 *   4. /schema 在引擎内部不可用（未装 ARGO）时优雅失败（502），服务不崩、健康仍在
 *   5. engine.ndjson 记录 start 与 schema 事件（vlog 打点）
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

async function waitHealth(base, attempts) {
  for (let i = 0; i < attempts; i += 1) { try { const r = await fetch(`${base}/health`); if (r.ok) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  return false;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-obs-'));
  const argoRoot = path.join(tmp, '.argo');
  const mirrorsRoot = path.join(tmp, 'mirrors');
  const logDir = path.join(tmp, 'logs');
  fs.mkdirSync(argoRoot, { recursive: true });
  fs.writeFileSync(path.join(argoRoot, 'package.json'), JSON.stringify({ name: 'archgraph-argo', version: '9.9.9' }), 'utf8');
  fs.mkdirSync(path.join(mirrorsRoot, 'X', 'design', 'KG'), { recursive: true });
  fs.writeFileSync(path.join(mirrorsRoot, 'X', 'design', 'KG', 'SystemArchitecture.json'), '{}\n', 'utf8');
  fs.mkdirSync(path.join(mirrorsRoot, '.meta'), { recursive: true });
  const syncedAt = new Date().toISOString();
  fs.writeFileSync(path.join(mirrorsRoot, '.meta', 'X.json'), JSON.stringify({ commit: 'abc123', ok: true, neo4jOk: true, semanticOk: true, syncedAt }), 'utf8');

  const port = 25000 + Math.floor(Math.random() * 8000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'mirror-engine-server.js')], {
    env: { ...process.env, ARGO_ROOT: argoRoot, MIRRORS_ROOT: mirrorsRoot, MIRROR_ENGINE_HOST: '127.0.0.1', MIRROR_ENGINE_PORT: String(port), GRAPH_STORE_LOG_DIR: logDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    check(await waitHealth(base, 25), 'engine ready');

    const health = await (await fetch(`${base}/health`)).json();
    check(health.status === 'ok' && health.argoVersion === '9.9.9', 'THEN1 /health 暴露 argoVersion');
    check(health.logDir === logDir, 'THEN1 /health 暴露 logDir');

    const list = await (await fetch(`${base}/mirrors`)).json();
    const m = (list.mirrors || []).find((x) => x.projectId === 'X');
    check(!!m && m.ok === true && m.commit === 'abc123' && m.syncedAt === syncedAt && m.neo4jOk === true && m.semanticOk === true, 'THEN2 /mirrors 暴露 commit/syncedAt/neo4jOk/semanticOk');

    const denied = await (await fetch(`${base}/schema`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'Nope' }) })).json();
    check(denied.status === 'denied' && denied.reason === 'mirror_not_synced', 'THEN3 /schema 未同步成员 403 mirror_not_synced');

    const res = await fetch(`${base}/schema`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'X' }) });
    const json = await res.json();
    check(res.status === 502 && json.status === 'failed', 'THEN4 引擎内部不可用时 /schema 优雅失败（502）');
    const health2 = await (await fetch(`${base}/health`)).json();
    check(health2.status === 'ok', 'THEN4 失败后服务仍然健康');

    const lines = fs.readFileSync(path.join(logDir, 'engine.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    check(lines.some((e) => e.kind === 'start' && e.argoVersion === '9.9.9'), 'THEN5 记录 start 打点（含版本）');
    check(lines.some((e) => e.kind === 'schema' && e.projectId === 'X' && e.status === 'failed'), 'THEN5 记录 schema 失败打点');
  } finally {
    child.kill();
    await new Promise((resolve) => { let done = false; const f = () => { if (!done) { done = true; resolve(); } }; child.once('exit', f); setTimeout(f, 800); });
  }

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: 镜像引擎可观测性验收通过。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
