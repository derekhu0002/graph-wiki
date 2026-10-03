#!/usr/bin/env node
'use strict';
/**
 * graph-store CLI
 *
 *   graph-store deploy [--config <env-file>]   # one-command install/deploy (Linux + root)
 *   graph-store serve                          # run the Graph Store service (asset MCP) in foreground
 *   graph-store engine                         # run the ARGO mirror engine in foreground
 *   graph-store web                            # run the community site (website/build) in foreground
 *   graph-store patrol [--heal]                # inspect logs/mirrors/drift; --heal re-syncs broken mirrors
 *   graph-store doctor                         # environment check
 *   graph-store version
 *
 * The publish/install flow:
 *   npm publish                 # (maintainers) publish graph-store to the registry
 *   npm i -g graph-store@x.y.z  # on a server
 *   graph-store deploy          # install + start services; then open localhost:18792
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const PKG_DIR = path.resolve(__dirname, '..');
const pkg = require(path.join(PKG_DIR, 'package.json'));

function help() {
  console.log(`graph-store ${pkg.version}

Usage:
  graph-store deploy [--config <env-file>]   Install + start services (Linux, root). Config from
                                             deploy/graph-store.env or --config; default data dir /opt/graph-store.
  graph-store serve                          Run the Graph Store (asset MCP) in the foreground.
  graph-store engine                         Run the ARGO mirror engine in the foreground.
  graph-store web                            Run the community site (website/build) in the foreground.
  graph-store patrol [--heal]                Inspect logs/mirrors/drift and report findings; --heal re-syncs broken mirrors.
  graph-store doctor                         Check the environment (node/docker/curl/bash).
  graph-store version

After deploy:
  MCP :  http://127.0.0.1:18792/mcp
  REST:  http://127.0.0.1:18792/graph/read
`);
}

function doctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(['node >= 18', nodeMajor >= 18, process.versions.node]);
  for (const bin of ['docker', 'curl', 'bash', 'git']) {
    const r = spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8' });
    checks.push([bin, r.status === 0, (r.stdout || '').trim()]);
  }
  const argo = path.join(process.env.HOME || '/root', '.argo', 'scripts');
  checks.push(['~/.argo engine', fs.existsSync(argo), argo]);
  let ok = true;
  for (const [name, pass, detail] of checks) {
    if (!pass) ok = false;
    console.log(`${pass ? 'ok  ' : 'MISS'} ${name}${detail ? '  (' + detail + ')' : ''}`);
  }
  process.exit(ok ? 0 : 1);
}

const cmd = process.argv[2] || 'help';
switch (cmd) {
  case 'deploy': {
    const script = path.join(PKG_DIR, 'deploy', 'install-graph-store.sh');
    if (!fs.existsSync(script)) { console.error('installer not found: ' + script); process.exit(1); }
    const args = process.argv.slice(3);
    const r = spawnSync('bash', [script, ...args], { stdio: 'inherit', env: { ...process.env, GRAPH_STORE_PKG_DIR: PKG_DIR } });
    process.exit(r.status === null ? 1 : r.status);
    break;
  }
  case 'serve':
    require(path.join(PKG_DIR, 'mcp', 'asset-mcp-server.js'));
    break;
  case 'engine':
    require(path.join(PKG_DIR, 'mcp', 'mirror-engine-server.js'));
    break;
  case 'web':
    require(path.join(PKG_DIR, 'mcp', 'static-server.js'));
    break;
  case 'patrol': {
    const { runPatrol } = require(path.join(PKG_DIR, 'mcp', 'patrol.js'));
    runPatrol({ heal: process.argv.includes('--heal') })
      .then((r) => process.exit(r.status === 'ok' ? 0 : 1))
      .catch((e) => { console.error(`patrol failed: ${e && e.message ? e.message : e}`); process.exit(1); });
    break;
  }
  case 'doctor':
    doctor();
    break;
  case 'version':
    console.log(pkg.version);
    break;
  default:
    help();
}
