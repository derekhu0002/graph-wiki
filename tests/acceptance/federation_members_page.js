/**
 * Acceptance Test - 联邦成员页（社区站人类可见成员清单）
 *
 * External-view acceptance（GIVEN-WHEN-THEN，可执行）：
 *
 * GIVEN 联邦注册中心 registry 已就绪且含成员（archgraph，带 role/capabilities/openContent 引用）
 * WHEN 页面数据源（registry_discover）被调用，且页面源码按其契约渲染成员
 * THEN
 *   1. discover 返回全部成员，每个成员含 id/name/role/capabilities[]/openContent[]（含 ref 引用）
 *   2. archgraph 成员带 4 项 capabilities、2 条 openContent，且 openContent 均为引用（ref 非空，指向成员自身位置）
 *   3. 页面源码以 ref 链接呈现 openContent（href 绑定 ref），不内联/抓取他人内容
 *   4. MCP 客户端（website/src/lib/mcp.ts）暴露 registryDiscover，经 registry_discover 拉取成员清单
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const registry = require('../../mcp/registry.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'website', 'src', 'pages', 'federation.tsx');
const MCP_LIB_PATH = path.join(REPO_ROOT, 'website', 'src', 'lib', 'mcp.ts');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  // ---------- 行为验收（数据源契约，临时 registry 不污染真实资产库） ----------
  const registryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fed-page-')), 'registry.json');
  let reg = registry.emptyRegistry();

  const archgraph = {
    id: 'archgraph',
    name: 'ArchGraph 框架项目',
    role: 'ArchGraph 框架项目：提供联邦规则、ARGO MCP 工具链与 Graph MCP 接口契约',
    capabilities: [
      '架构意图图框架',
      'ARGO MCP 工具链',
      '联邦规则与 MCP 接口契约',
      '多 Agent 记忆与语义检索',
    ],
    openContent: [
      {
        id: 'archgraph-federation-rules',
        name: '框架侧联邦规则与工具契约（FederationGuideline + CoreRule 12）',
        ref: 'https://github.com/derekhu0002/archgraph/blob/main/argo/rules/archgraph.instructions.md',
      },
      {
        id: 'archgraph-federation-design',
        name: '联邦式组织级图谱设计稿（中心机构 + 规则内化）',
        ref: 'graph://archgraph/design/KG/SystemArchitecture.json#overseer-federation-center-design-001',
      },
    ],
    sourceRepo: 'https://github.com/derekhu0002/archgraph',
  };
  registry.registerMember(reg, archgraph);
  registry.save(registryPath, reg);
  reg = registry.load(registryPath);

  const members = registry.discover(reg);

  // THEN 1: discover 返回全部成员且字段齐全
  if (members.length !== 1 || members[0].id !== 'archgraph') {
    fail(`THEN1 失败: discover 未返回 archgraph 成员 ${JSON.stringify(members)}`);
  }
  for (const field of ['id', 'name', 'role', 'capabilities', 'openContent', 'sourceRepo']) {
    if (!(field in members[0])) fail(`THEN1 失败: 成员缺少字段 ${field}`);
  }

  // THEN 2: archgraph 能力与开放内容引用齐备
  if (members[0].capabilities.length !== 4) {
    fail(`THEN2 失败: capabilities 应为 4 项，实为 ${members[0].capabilities.length}`);
  }
  if (members[0].openContent.length !== 2) {
    fail(`THEN2 失败: openContent 应为 2 项，实为 ${members[0].openContent.length}`);
  }
  for (const c of members[0].openContent) {
    if (typeof c.ref !== 'string' || c.ref === '') {
      fail(`THEN2 失败: openContent 应为引用而非副本 ${JSON.stringify(c)}`);
    }
  }

  // ---------- 结构验收（页面契约：以 ref 链接呈现，不内联内容） ----------
  if (!fs.existsSync(PAGE_PATH)) fail(`THEN3 失败: 页面缺失 ${PAGE_PATH}`);
  if (!fs.existsSync(MCP_LIB_PATH)) fail(`THEN4 失败: 客户端缺失 ${MCP_LIB_PATH}`);

  const pageSrc = fs.readFileSync(PAGE_PATH, 'utf8');
  const libSrc = fs.readFileSync(MCP_LIB_PATH, 'utf8');

  // THEN 3: 页面以 ref 链接呈现 openContent（href 绑定 ref，外部链接 target/_blank），不内联抓取
  if (!/href=\{c\.ref\}/.test(pageSrc) && !/href=\{.*\.ref\}/.test(pageSrc)) {
    fail(`THEN3 失败: 页面未以 ref 链接呈现 openContent ${PAGE_PATH}`);
  }
  if (!/target="_blank"/.test(pageSrc)) {
    fail('THEN3 失败: 页面 openContent 引用应新窗口打开（target="_blank"）');
  }

  // THEN 4: MCP 客户端暴露 registryDiscover，经 registry_discover 拉取
  if (!/registryDiscover/.test(libSrc) || !/registry_discover/.test(libSrc)) {
    fail('THEN4 失败: mcp.ts 未暴露 registryDiscover（调用 registry_discover）');
  }
  if (!/registryDiscover/.test(pageSrc)) {
    fail('THEN4 失败: 页面未调用 registryDiscover 拉取成员清单');
  }

  console.log(
    'PASS: 联邦成员页验收通过——registry_discover 返回成员 ' +
      `${members.map((m) => m.id).join(', ')}（含 role/capabilities/openContent 引用），` +
      '页面以 ref 链接呈现开放内容（不内联内容），客户端经 registry_discover 拉取。'
  );
}

main();
