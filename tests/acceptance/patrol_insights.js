/**
 * Acceptance Test - 巡检与日志洞察（vlog 打点 → 巡检 → 发现/自愈）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 一份注入了故障信号的 JSONL 日志（同步失败/语义失败/schema 失败/拒绝率高）+ 引擎健康与副本清单 + 成员 registry
 * WHEN 运行 ensure patrol（runPatrol）
 * THEN
 *   1. 镜像 not ok → 发现 mirror_not_ok（error）
 *   2. 同步失败事件 → 发现 sync_failed
 *   3. 语义生命周期失败 → 发现 semantic_failed
 *   4. schema 解析失败 → 发现 schema_failed
 *   5. 读拒绝率超阈值 → 发现 read_deny_rate_high
 *   6. 副本 commit 落后上游 → 发现 mirror_drift
 *   7. ARGO 版本相对上次巡检变化 → 发现 argo_version_changed（框架升级信号）
 *   8. heal=true 时对 not ok 副本触发一次 mirror_sync（自愈）
 *   9. 巡检事件写入 patrol.ndjson 且生成 patrol-latest.json 快照
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrol-repo-'));
  const run = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  run(['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
  run(['add', '.']);
  run(['commit', '-q', '-m', 'init']);
  return { dir, head: run(['rev-parse', 'HEAD']).trim() };
}

function stubClient(mirrors, health, syncCalls, schemaOk = true) {
  return {
    getHealth: async () => ({ json: health }),
    listMirrors: async () => ({ json: { status: 'ok', count: mirrors.length, mirrors } }),
    getSchema: async (body) => ({ json: schemaOk
      ? { status: 'ok', projectId: body.projectId, schema: { elementTypes: ['Thing'], relationshipTypes: ['Connects'], closed: true } }
      : { status: 'failed', reason: 'schema_unparsable', projectId: body.projectId } }),
    syncMirror: async (body) => { syncCalls.push(body); return { json: { status: 'ok', synced: true, projectId: body.projectId } }; },
  };
}

async function main() {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrol-log-'));
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patrol-assets-'));
  fs.mkdirSync(path.join(assetRoot, 'registry'), { recursive: true });
  process.env.GRAPH_STORE_LOG_DIR = logDir;

  const repo = makeRepo();
  const registry = require('../../mcp/registry.js');
  const reg = registry.emptyRegistry();
  registry.registerMember(reg, { id: 'A', name: '项目 A' });
  registry.registerMember(reg, { id: 'B', name: '项目 B', sourceRepo: repo.dir, branch: 'main' });
  registry.registerMember(reg, { id: 'C', name: '项目 C', sourceRepo: repo.dir, branch: 'dev' });
  registry.registerMember(reg, { id: 'D', name: '项目 D', sourceRepo: path.join(os.tmpdir(), 'no-such-repo-for-patrol'), branch: 'main' });
  registry.registerMember(reg, { id: 'E', name: '项目 E' });
  registry.save(path.join(assetRoot, 'registry', 'registry.json'), reg);

  const now = Date.now();
  const ev = (msAgo, e) => JSON.stringify({ ts: new Date(now - msAgo).toISOString(), ...e });
  fs.writeFileSync(path.join(logDir, 'engine.ndjson'), [
    ev(3 * 3600e3, { kind: 'start', argoVersion: '0.26.2' }),
    ev(3600e3, { kind: 'sync', projectId: 'A', status: 'failed', reason: 'graph_not_found' }),
    ev(3400e3, { kind: 'sync', projectId: 'E', status: 'ok', synced: false, reason: 'fetch_failed_kept_checkout', fetchOk: false, fetchError: 'timeout', branch: 'main', commit: 'mirror-e' }),
    ev(3500e3, { kind: 'sync', projectId: 'B', status: 'ok', synced: true, neo4jOk: true, semanticOk: false, commit: 'mirror-b' }),
    ev(3700e3, { kind: 'sync', projectId: 'F', status: 'failed', reason: 'graph_not_found' }),
    ev(3200e3, { kind: 'sync', projectId: 'F', status: 'ok', synced: false, reason: 'up-to-date', fetchOk: true, commit: 'mirror-f' }),
    ev(3000e3, { kind: 'schema', projectId: 'B', status: 'failed', reason: 'schema_unparsable' }),
    ev(2000e3, { kind: 'read', projectId: 'A', tool: 'queryNeo4jGraph', status: 'denied', reason: 'not_authorized' }),
    ev(1900e3, { kind: 'read', projectId: 'A', tool: 'queryNeo4jGraph', status: 'denied', reason: 'not_authorized' }),
    ev(1800e3, { kind: 'read', projectId: 'B', tool: 'queryNeo4jGraph', status: 'ok' }),
    ev(2300e3, { kind: 'read', projectId: 'G', tool: 'memory_search', status: 'failed', reason: 'transient' }),
    ev(1700e3, { kind: 'read', projectId: 'G', tool: 'memory_search', status: 'ok' }),
    ev(1650e3, { kind: 'read', projectId: 'ghost', tool: 'memory_search', status: 'denied', reason: 'mirror_not_synced' }),
  ].join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(logDir, 'store.ndjson'), [
    ev(1000e3, { kind: 'graph_read', requester: 'B', projectId: 'A', tool: 'queryNeo4jGraph', status: 'denied', reason: 'not_authorized' }),
  ].join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(logDir, 'patrol.ndjson'), [
    ev(4 * 3600e3, { kind: 'patrol', status: 'ok', argoVersion: '0.26.1' }),
  ].join('\n') + '\n', 'utf8');

  const syncCalls = [];
  const mirrors = [
    { projectId: 'A', synced: false, ok: false },
    { projectId: 'B', synced: true, ok: true, commit: 'stale-mirror-commit', branch: 'main', syncedAt: new Date(now - 3 * 3600e3).toISOString() },
    { projectId: 'C', synced: true, ok: true, commit: 'mirror-c', branch: 'main', syncedAt: new Date(now - 3 * 3600e3).toISOString() },
    { projectId: 'D', synced: true, ok: true, commit: 'mirror-d', branch: 'main', syncedAt: new Date(now - 3 * 3600e3).toISOString() },
    { projectId: 'E', synced: true, ok: true, commit: 'mirror-e', branch: 'main', syncedAt: new Date(now - 3 * 3600e3).toISOString() },
  ];
  const health = { status: 'ok', service: 'argo-mirror-engine', argoVersion: '0.26.2', activeSyncs: 0, queuedSyncs: 0 };

  const patrol = require('../../mcp/patrol.js');
  const report = await patrol.runPatrol({
    engineClient: stubClient(mirrors, health, syncCalls),
    assetRoot,
    heal: true,
    silent: true,
    windowMs: 24 * 3600e3,
    denyRateWarn: 0.2,
    minReads: 3,
  });

  const codes = new Set(report.findings.map((f) => f.code));
  check(report.status !== 'ok', 'THEN0 有故障信号时巡检不为 ok');
  check(codes.has('mirror_not_ok'), 'THEN1 发现 mirror_not_ok');
  check(codes.has('sync_failed'), 'THEN2 发现 sync_failed');
  check(codes.has('semantic_failed'), 'THEN3 发现 semantic_failed');
  check(codes.has('schema_failed'), 'THEN4 发现 schema_failed');
  check(codes.has('read_deny_rate_high'), 'THEN5 发现 read_deny_rate_high');
  check(codes.has('sync_fetch_failed'), 'THEN5b 发现 sync_fetch_failed（fetch 失败不再被静默吞掉）');
  check(codes.has('mirror_branch_mismatch'), 'THEN5c 发现 mirror_branch_mismatch（镜像分支与注册分支不一致）');
  check(codes.has('mirror_drift'), 'THEN6 发现 mirror_drift');
  check(codes.has('upstream_unreachable'), 'THEN6b ls-remote 失败不再静默，报告 upstream_unreachable');
  check(!report.findings.some((f) => f.projectId === 'F'), 'THEN6c 后到的成功事件清除先前的失败（按项目取最新）');
  check(!report.findings.some((f) => f.code === 'read_failed' && f.projectId === 'G'), 'THEN6d 读成功清除先前的读失败（按项目+工具取最新）');
  check(!report.findings.some((f) => f.code === 'read_failed' && f.projectId === 'ghost'), 'THEN6e 非注册成员（探针）读失败不告警');
  check(report.findings.some((f) => f.code === 'read_failed' && f.projectId === 'A'), 'THEN6e 注册成员的读失败仍告警');
  check(codes.has('argo_version_changed'), 'THEN7 发现 argo_version_changed（框架升级信号）');
  check(syncCalls.some((c) => c.projectId === 'A'), 'THEN8 heal 对 not ok 副本触发 mirror_sync');
  check(!syncCalls.some((c) => c.projectId === 'B'), 'THEN8 ok 副本不误重建');
  const patrolLog = fs.readFileSync(path.join(logDir, 'patrol.ndjson'), 'utf8');
  check(patrolLog.includes('"kind":"patrol"') && patrolLog.includes('"status":"attention"'), 'THEN9 巡检事件写入 patrol.ndjson');
  check(fs.existsSync(path.join(logDir, 'patrol-latest.json')), 'THEN9 生成 patrol-latest.json 快照');

  const clean = await patrol.runPatrol({
    engineClient: stubClient([{ projectId: 'B', synced: true, ok: true, commit: repo.head, syncedAt: new Date().toISOString() }], health, [], true),
    assetRoot,
    heal: false,
    silent: true,
    windowMs: 1,
  });
  check(clean.status === 'ok' && clean.findings.length === 0, 'THEN0b 无故障信号且窗口为空时巡检为 ok');

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: 巡检与日志洞察验收通过。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
