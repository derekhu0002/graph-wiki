#!/usr/bin/env node
/**
 * 联邦注册中心 Registry（P0 只读）——纯 Node 零依赖数据/授权模块。
 *
 * 定位：ArchGraph「联邦式组织级图谱」的中心（Registry）。每个项目是自治的「国家」，
 * 各自维护自己的意图图；组织是「联邦」。中心只保存两样东西：
 *   1. 成员元数据（身份/作用职责/能力/对外开放内容清单——清单是引用，不是内容副本）
 *   2. 授权记录（谁授权谁读什么）
 *
 * 内容主权归成员：中心绝不保存成员内容副本；「跨国走引用」——授权后读取返回的
 * 是成员开放内容的引用（ref 指向成员自身图谱/仓库），由请求方按引用到成员侧取内容。
 *
 * 本模块无 I/O 副作用依赖，可被 MCP 服务与验收测试共同复用。所有读写通过
 * 显式传入的 registryPath 完成（服务默认 assets/registry/registry.json，测试用临时文件）。
 */

const fs = require('node:fs');
const path = require('node:path');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyRegistry() {
  return { schemaVersion: '1.0', lastUpdated: today(), members: [], grants: [] };
}

function load(registryPath) {
  if (!fs.existsSync(registryPath)) return emptyRegistry();
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyRegistry();
    return {
      ...emptyRegistry(),
      ...raw,
      members: Array.isArray(raw.members) ? raw.members : [],
      grants: Array.isArray(raw.grants) ? raw.grants : [],
    };
  } catch {
    return emptyRegistry();
  }
}

function save(registryPath, registry) {
  registry.lastUpdated = today();
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

// 对外开放内容清单：统一为引用项（id/name/ref），ref 指向成员自身内容位置。
function normalizeOpenContent(list) {
  return (Array.isArray(list) ? list : []).map((c) => {
    if (typeof c === 'string') return { id: c, name: c, ref: c };
    return {
      id: String(c.id || ''),
      name: String(c.name || c.id || ''),
      ref: String(c.ref || c.id || ''),
    };
  }).filter((c) => c.id !== '');
}

function registerMember(registry, input) {
  input = input || {};
  const id = String(input.id || '').trim();
  if (!id) throw new Error('registry_register 缺少成员 id');
  const member = {
    id,
    name: String(input.name || id),
    role: String(input.role || ''),
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String) : [],
    openContent: normalizeOpenContent(input.openContent),
    sourceRepo: String(input.sourceRepo || ''),
    status: 'active',
    registeredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const idx = registry.members.findIndex((m) => m.id === id);
  if (idx >= 0) {
    member.registeredAt = registry.members[idx].registeredAt || member.registeredAt;
    registry.members[idx] = member;
  } else {
    registry.members.push(member);
  }
  return member;
}

function deregisterMember(registry, id) {
  const idx = registry.members.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error(`成员不存在: ${id}`);
  registry.members.splice(idx, 1);
  registry.grants = (registry.grants || []).filter(
    (g) => g.grantor !== id && g.grantee !== id
  );
  return { deregistered: id };
}

function publicMember(m) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    capabilities: m.capabilities,
    openContent: m.openContent,
    sourceRepo: m.sourceRepo,
  };
}

function discover(registry) {
  return registry.members.filter((m) => m.status === 'active').map(publicMember);
}

function authorize(registry, input) {
  input = input || {};
  const grantor = String(input.grantor || '').trim();
  const grantee = String(input.grantee || '').trim();
  if (!grantor || !grantee) throw new Error('registry_authorize 缺少 grantor/grantee');
  if (!registry.members.some((m) => m.id === grantor && m.status === 'active')) {
    throw new Error(`授权方未注册或已注销: ${grantor}`);
  }
  const contentId = String(input.contentId || '*').trim() || '*';
  const existing = (registry.grants || []).find(
    (g) => g.grantor === grantor && g.grantee === grantee && g.contentId === contentId
  );
  if (existing) return existing;
  const grant = { grantor, grantee, contentId, grantedAt: new Date().toISOString() };
  registry.grants.push(grant);
  return grant;
}

function isAuthorized(registry, requester, member, contentId) {
  const key = String(contentId || '*').trim() || '*';
  return (registry.grants || []).some(
    (g) =>
      g.grantor === member &&
      g.grantee === requester &&
      (g.contentId === key || g.contentId === '*')
  );
}

// 授权后读取：默认拒绝。命中授权则返回成员开放内容引用（不返回内容副本）。
function readAuthorized(registry, input) {
  input = input || {};
  const requester = String(input.requester || '').trim();
  const member = String(input.member || '').trim();
  const contentId = input.contentId ? String(input.contentId).trim() : '';
  const target = registry.members.find((m) => m.id === member && m.status === 'active');
  if (!target) {
    return { status: 'denied', reason: 'member_not_found', requester, member, content: [] };
  }
  if (!isAuthorized(registry, requester, member, contentId)) {
    return { status: 'denied', reason: 'not_authorized', requester, member, content: [] };
  }
  const items =
    contentId && contentId !== '*'
      ? target.openContent.filter((c) => c.id === contentId)
      : target.openContent;
  return { status: 'ok', requester, member, content: items };
}

module.exports = {
  emptyRegistry,
  load,
  save,
  registerMember,
  deregisterMember,
  discover,
  authorize,
  isAuthorized,
  readAuthorized,
};
