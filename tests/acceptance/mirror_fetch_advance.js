/**
 * Acceptance Test - 镜像 fetch 推进与分支切换（mirror-git 回归）
 *
 * 外部视角验收（GIVEN-WHEN-THEN，可执行，基于真实 git 仓）：
 *
 * GIVEN 一个上游 git 仓 + 一个镜像 workspace
 * WHEN 依次 clone、上游新增提交后再次 fetch、切到新分支、对不可达远端 fetch
 * THEN
 *   1. 首次 fetch 克隆成功且 HEAD = 上游首提交
 *   2. 上游新增提交后再次 fetch，HEAD 必须推进到最新（回归：fetch 无 destination refspec 时 origin/<branch> 不更新）
 *   3. 切换到上游新分支后 HEAD = 新分支 tip（分支切换生效）
 *   4. 远端不可达时 fetchOk=false 且保留当前 checkout（不崩、不谎报 up-to-date）
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { fetchRepo } = require('../../mcp/mirror-git.js');

let failures = 0;
function check(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failures += 1; } else { console.log(`ok: ${msg}`); } }

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(dir, file, content) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `c:${content}`);
  return git(dir, 'rev-parse', 'HEAD');
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-git-'));
  const remote = path.join(tmp, 'remote');
  const mirror = path.join(tmp, 'mirror');
  fs.mkdirSync(remote, { recursive: true });
  git(remote, 'init', '-q', '-b', 'main');
  const c1 = commit(remote, 'f.txt', 'one');

  // THEN 1: clone
  const r1 = await fetchRepo(mirror, remote, 'main');
  check(r1.fetchOk === true && r1.branch === 'main', 'THEN1 首次 fetch 克隆成功');
  check(git(mirror, 'rev-parse', 'HEAD') === c1, 'THEN1 HEAD = 上游首提交');

  // THEN 2: upstream advances → HEAD must advance (refspec regression)
  const c2 = commit(remote, 'f.txt', 'two');
  const r2 = await fetchRepo(mirror, remote, 'main');
  check(r2.fetchOk === true, 'THEN2 再次 fetch 成功');
  check(git(mirror, 'rev-parse', 'HEAD') === c2, 'THEN2 HEAD 推进到上游最新提交');

  // THEN 3: switch to a new upstream branch
  git(remote, 'checkout', '-q', '-b', 'dev');
  const c3 = commit(remote, 'g.txt', 'dev-only');
  git(remote, 'checkout', '-q', 'main');
  const r3 = await fetchRepo(mirror, remote, 'dev');
  check(r3.fetchOk === true && r3.branch === 'dev', 'THEN3 切分支 fetch 成功');
  check(git(mirror, 'rev-parse', 'HEAD') === c3, 'THEN3 HEAD = 新分支 tip');

  // THEN 4: unreachable remote → fetchOk=false, keep checkout
  const gone = path.join(tmp, 'does-not-exist');
  git(mirror, 'remote', 'set-url', 'origin', gone);
  const r4 = await fetchRepo(mirror, gone, 'main');
  check(r4.fetchOk === false && !!r4.fetchError, 'THEN4 远端不可达 fetchOk=false 并带错误');
  check(git(mirror, 'rev-parse', 'HEAD') === c3, 'THEN4 保留当前 checkout');

  if (failures > 0) { console.error(`\n${failures} failed`); process.exit(1); }
  console.log('\nPASS: 镜像 fetch 推进与分支切换验收通过。');
}

main().catch((e) => { console.error(`FAIL: ${e && e.stack ? e.stack : e}`); process.exit(1); });
