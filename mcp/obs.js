#!/usr/bin/env node
'use strict';
/**
 * Structured JSONL observability sink shared by the Graph Store service, the ARGO
 * mirror engine, and the patrol driver. Every write is best-effort: logging must
 * never break a service call.
 *
 * Env:
 *   GRAPH_STORE_LOG_DIR       default ~/.graph-store/logs
 *   GRAPH_STORE_LOG_MAX_BYTES rotation threshold, default 5 MiB
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_BYTES = Number(process.env.GRAPH_STORE_LOG_MAX_BYTES || 5 * 1024 * 1024);

function logDir() {
  return process.env.GRAPH_STORE_LOG_DIR || path.join(os.homedir(), '.graph-store', 'logs');
}

function logPath(name) {
  return path.join(logDir(), `${name}.ndjson`);
}

function append(name, event) {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const p = logPath(name);
    try {
      if (fs.statSync(p).size > MAX_BYTES) {
        fs.rmSync(`${p}.1`, { force: true });
        fs.renameSync(p, `${p}.1`);
      }
    } catch { /* new file */ }
    fs.appendFileSync(p, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, 'utf8');
  } catch { /* observability must never break the caller */ }
}

function readFileEvents(file, options) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (options.since && ev.ts && Date.parse(ev.ts) < options.since) continue;
    if (options.kind && ev.kind !== options.kind) continue;
    out.push(ev);
  }
  return out;
}

function read(name, options = {}) {
  const events = [];
  if (options.includeRotated) events.push(...readFileEvents(`${logPath(name)}.1`, options));
  events.push(...readFileEvents(logPath(name), options));
  events.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  if (options.limit && events.length > options.limit) return events.slice(-options.limit);
  return events;
}

function latest(name, kind) {
  const events = read(name, { kind });
  return events.length ? events[events.length - 1] : null;
}

module.exports = { logDir, logPath, append, read, latest };
