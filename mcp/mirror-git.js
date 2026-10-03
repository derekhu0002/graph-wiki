#!/usr/bin/env node
'use strict';
/**
 * Git operations for the ARGO mirror engine (workspace clone/fetch).
 *
 * Fetch uses an explicit refspec (`+refs/heads/<branch>:refs/remotes/origin/<branch>`)
 * because `git fetch origin <branch>` only updates FETCH_HEAD and leaves
 * `origin/<branch>` stale — `reset --hard origin/<branch>` would then never advance
 * to a new upstream commit nor switch branches.
 *
 * Fetch failures are reported (`fetchOk:false`), never silently swallowed: callers
 * keep the current checkout for resilience but must flag the mirror as possibly stale.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
// Force HTTP/1.1 (github.com's HTTP/2 framing is intermittently fatal) and abort
// stalled transfers instead of hanging the sync slot for minutes.
const NET_CFG = [
  '-c', 'http.version=HTTP/1.1',
  '-c', 'http.lowSpeedLimit=1000',
  '-c', 'http.lowSpeedTime=60',
];
const NET_TIMEOUT_MS = Number(process.env.MIRROR_GIT_TIMEOUT_MS || 120000);

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

function gitAsync(args, cwd, timeoutMs) {
  return execFileAsync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs || NET_TIMEOUT_MS })
    .then((r) => r.stdout.trim());
}

async function cloneWithRetry(dir, sourceRepo, branchName) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await gitAsync([...NET_CFG, 'clone', '--depth', '1', '--branch', branchName, sourceRepo, '.'], dir, NET_TIMEOUT_MS);
      return;
    } catch (e) {
      lastErr = e;
      try { fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true }); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

async function fetchRepo(dir, sourceRepo, branch) {
  const branchName = branch || 'main';
  const refspec = `+refs/heads/${branchName}:refs/remotes/origin/${branchName}`;
  const hasGit = fs.existsSync(path.join(dir, '.git'));
  if (!hasGit) {
    if (!sourceRepo) return { dir, fetchOk: false, branch: branchName, fetchError: 'no_sourceRepo' };
    try {
      fs.mkdirSync(dir, { recursive: true });
      await cloneWithRetry(dir, sourceRepo, branchName);
    } catch (e) {
      return { dir, fetchOk: false, branch: branchName, fetchError: String(e && e.message ? e.message : e) };
    }
    return { dir, fetchOk: true, branch: branchName };
  }
  // An existing checkout always refreshes from its `origin`, even when the caller
  // omitted sourceRepo — silently skipping the fetch would masquerade as up-to-date.
  try {
    await gitAsync([...NET_CFG, 'fetch', '--depth', '1', 'origin', refspec], dir, NET_TIMEOUT_MS);
    await gitAsync(['reset', '--hard', `origin/${branchName}`], dir);
    return { dir, fetchOk: true, branch: branchName };
  } catch (e) {
    return { dir, fetchOk: false, branch: branchName, fetchError: String(e && e.message ? e.message : e) };
  }
}

module.exports = { git, gitAsync, cloneWithRetry, fetchRepo };
