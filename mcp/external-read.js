#!/usr/bin/env node
/**
 * 外部图读取编排（External Graph Read）——纯 Node 零依赖。
 *
 * 组合两件事：
 *   1. 授权校验：复用联邦注册中心 registry.js 的 grants（默认拒绝）。
 *   2. 副本查询：在中心托管的成员副本命名空间 proj:<projectId> 内执行只读查询。
 *
 * 这是「跨项目图谱查询」新接口（graph_read_external / REST POST /graph/read）的
 * 唯一业务入口，与既有的 registry_read（返回 openContent 引用）互不复用、互不影响。
 */
const registry = require('./registry.js');
const mirror = require('./mirror.js');

function readExternal(input) {
  const {
    registryPath,
    mirrorRoot,
    requester,
    projectId,
    contentId,
    op,
    ...rest
  } = input || {};

  if (!requester || !projectId) {
    return { status: 'bad_request', reason: 'missing_requester_or_projectId', requester, projectId };
  }
  const reg = registry.load(registryPath);
  const member = (reg.members || []).find((m) => m.id === projectId && m.status === 'active');
  if (!member) {
    return { status: 'denied', reason: 'member_not_found', requester, projectId };
  }
  if (!registry.isAuthorized(reg, requester, projectId, contentId)) {
    return { status: 'denied', reason: 'not_authorized', requester, projectId };
  }
  if (!mirror.exists(mirrorRoot, projectId)) {
    return { status: 'denied', reason: 'mirror_not_synced', requester, projectId };
  }
  const meta = mirror.getMeta(mirrorRoot, projectId);
  const result = mirror.query(mirrorRoot, projectId, { op, ...rest });
  if (result && result.status === 'not_found') {
    return { status: 'denied', reason: 'mirror_not_synced', requester, projectId };
  }
  return {
    status: 'ok',
    requester,
    projectId,
    namespaceKey: meta.namespaceKey,
    version: meta.commit,
    syncedAt: meta.syncedAt,
    result,
  };
}

module.exports = { readExternal };
