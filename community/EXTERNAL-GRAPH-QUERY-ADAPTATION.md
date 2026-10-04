# 跨项目图谱查询：Graph 项目（ArchGraph 框架）适配需求说明书

> 状态：**已刷新**（镜像宿主 47.107.161.168 + ARGO 引擎复用，commit 见文末）
> 面向：ArchGraph 框架项目（下称「Graph 项目」）
> 目的：说明 Graph 项目的 ARGO MCP 需要做的适配，使任一项目的 Agent 在查询时可携带一个外部项目 ID，读取外仓知识图谱；不携带时保持本仓行为不变。

## 1. 背景与目标

Graph Store（graph-wiki 中心）已交付「跨项目图谱查询」：中心托管成员经 **push/merge 审核**后开放的图谱，**复用 ARGO 引擎**完成 Neo4j 投影 + Qwen 向量化，并按项目 ID 提供**授权后只读**的查询接口（默认拒绝）。成员仓仍是事实源，中心不改写成员仓。

Graph 项目作为 Agent 侧入口，需要让所有**数据查询/检索接口**支持一个可选 `projectId`：缺省=本仓，提供=外仓。二者之间**唯一的交汇**是：Graph 项目的查询在命中外仓时调用中心 REST 接口，由中心完成授权校验并转发给镜像引擎；两个 MCP 之间**没有直接代码耦合**。

## 2. 术语

- **Graph Store（120）**：graph-wiki 的公开服务，持联邦注册中心（成员/授权）与对外接口 `/mcp`、`/graph/read`；负责**授权判定**。
- **镜像宿主 / ARGO 镜像引擎（47.107.161.168）**：持有 Neo4j Enterprise + ARGO 引擎，负责**投影/向量化/查询**；每成员一个独立 **Neo4j database**（= `projectId`），与本地项目「一项目一库」一致。
- **projectId**：联邦成员全局唯一身份，注册时由中心确认唯一。
- **requester**：发起读取的项目自身 `projectId`。
- **本仓 / 外仓**：本项目的图谱 / 被查询的那个外部项目的图谱。

## 3. 架构与拓扑

```
[Graph 项目本地 ARGO MCP] --带 projectId--> POST https://argo.derekworkspacev5.com/graph/read
        └─ Graph Store(120)：registry 授权判定（默认拒绝）
             └─ 私网 172.18.2.191:18801 ─> ARGO 镜像引擎(47)
                    ├─ /mirror/sync  : git 拉取成员仓 → ARGO buildHarnessReport（Neo4j 投影 + .qea + Qwen embedding），按 git commit 幂等
                    ├─ /graph/read   : callTool(tool, {…, workspaceRoot})  ← 复用 ARGO 读取语义
                    └─ /mirror/remove: 删库 + 清工作区
```

- **并发安全**：读取/投影都按**每次调用**显式传 `workspaceRoot`（→ 派生独立 database），不修改进程级 env；A 查 A、B 查 B 互不影响。
- **副本建设**：注册即自动建副本；另有定时（每 30 分钟）+ 触发重同步，**按 git commit 幂等**（版本未变跳过，变了重投影+重嵌入）。

## 4. 已就绪的中心接口（Graph Store 侧，已交付）

### 4.1 REST（推荐 Graph 项目直接调用）

```
POST https://argo.derekworkspacev5.com/graph/read
Content-Type: application/json
```

请求体（工具名与 ARGO 读工具 **1:1 同名**，`args` 即该工具的原生参数；`workspaceRoot`/`architecturePath` 由引擎注入，不用传）：

```json
{
  "requester": "<self projectId>",
  "projectId": "<target projectId>",
  "tool": "getSystemArchitecture | getIntentElementContext | getArchitectureViewContext | queryNeo4jGraph | memory_search",
  "args": { "...": "该 ARGO 工具的原生参数" },
  "contentId": "可选，授权粒度，缺省 *"
}
```

示例：

```json
{ "requester": "soc-demo", "projectId": "archgraph", "tool": "queryNeo4jGraph",
  "args": { "cypher": "MATCH (e:Element {graphKey:$graphKey}) RETURN count(e) AS n" } }
```

成功（HTTP 200）：

```json
{ "status": "ok", "requester": "soc-demo", "projectId": "archgraph",
  "namespaceKey": "proj:archgraph", "tool": "queryNeo4jGraph",
  "result": { "status": "passed", "database": "archgraph", "graphKey": "design/KG/SystemArchitecture.json", "records": [ { "n": 298 } ] } }
```

拒绝（403）/错误（400）：

```json
{ "status": "denied", "reason": "not_authorized | member_not_found | mirror_not_synced", "requester": "…", "projectId": "…" }
{ "status": "bad_request", "reason": "tool_not_allowed:<tool> | …" }
```

### 4.2 MCP 工具（与 REST 同源）

`graph_read_external { requester, projectId, tool, args, contentId? }`。

### 4.3 管理（Graph MCP）

| 工具 | 用途 |
|---|---|
| `registry_register { id, name, role, capabilities, openContent, sourceRepo, branch }` | 注册；**自动触发一次镜像建设**；中心确认 `id` 唯一 |
| `registry_authorize { grantor, grantee, contentId }` | 所有方授权请求方（缺省 `*`）|
| `mirror_sync { projectId, sourceRepo?, branch? }` | 手动/重同步副本（按 git commit 幂等）|
| `mirror_list` | 列出已托管副本 |
| `registry_deregister { id }` | 注销并删除镜像（删库+清工作区）、回收授权 |

## 5. Graph 项目需要适配的内容（需求）

### FR-G1 获取并持久化本仓 projectId（前置）

- 首次接入：调用 `registry_register` 完成注册（会自动建副本），把中心确认的 `id` 作为本仓 `projectId`。
- **本地持久化**到工作区，例如 `.argo/federation.json`：
  ```json
  { "projectId": "<id>", "sourceRepo": "<repo>", "centerUrl": "https://argo.derekworkspacev5.com", "branch": "main" }
  ```
- ARGO MCP 外仓查询时读取该文件得到 **self projectId** 填 `requester`；**缺失时须报错提示先注册，不得猜测**。

### FR-G2 查询/检索工具新增可选参数 `projectId`

- 所有数据查询与检索工具（如 `getSystemArchitecture` / `getIntentElementContext` / `getArchitectureViewContext` / `queryNeo4jGraph` / `memory_search`）新增可选 `projectId`。
- 语义：
  - **缺省** → 本仓（现有行为、返回结构、性能**不变**）。
  - **提供** → 视为外仓：调用中心 `POST /graph/read`，`requester` 填本仓 `projectId`，`projectId` 填该参数，**`tool` 即当前工具名、`args` 即当前参数**（同名同参，映射几乎机械）。
- 建议在 MCP 服务内集中一个 **Graph Query Router** 层实现。

### FR-G3 结果与错误透传

- 成功：把中心 `result`（即 ARGO 原生结果）透传；并附带 `namespaceKey`。
- 失败：`denied` 返回明确 `reason`（`not_authorized`/`member_not_found`/`mirror_not_synced`）；**不得静默降级为本仓结果**。

### FR-G4 本仓零回归

- 不传 `projectId` 时，工具行为、返回结构、性能与现状一致。

## 6. 适配程度（可开放的 ARGO 读工具）

| tool | 对应 ARGO 读接口 |
|---|---|
| `getSystemArchitecture` | 语义检索（purpose/intent/scope）|
| `getIntentElementContext` | ArchiMate 语义依赖遍历 |
| `getArchitectureViewContext` | 视图成员解析（+ 可选几何）|
| `queryNeo4jGraph` | 只读 Cypher（`$graphKey` 作用域）|
| `memory_search` | embedding 语义检索 |

> 写工具在服务端**一律拒绝**（`tool_not_allowed`）。这就是「适配程度」的旋钮：加一个工具 = 加一条白名单。

## 7. 边界与限制

- **demo 阶段无强身份认证**：`requester` 为自称，安全依赖网络与授权记录，勿对外承诺强安全。
- **只读**：不得经该接口写外仓。
- **新鲜度**：副本按 git commit 同步（注册即建 + 每 30 分钟 + 触发），结果以引擎返回的 `database`/版本为准。
- 私有成员仓需在镜像宿主配置只读 Git 凭据。

## 8. 验收（GIVEN-WHEN-THEN）

1. **本仓不变**：GIVEN 不传 `projectId`，WHEN 查询任一工具，THEN 与本仓现状一致。
2. **外仓授权读**：GIVEN 已注册本仓（含本地身份）、目标已建副本且已授权，WHEN 带 `projectId` 查询，THEN 返回目标项目结果（含 `database`=目标）。
3. **默认拒绝**：GIVEN 未授权，WHEN 带 `projectId` 查询，THEN 明确 `denied / not_authorized`，不降级。
4. **身份缺失**：GIVEN 本地无联邦身份，WHEN 发起外仓查询，THEN 报错提示先注册。

## 9. 交付与验证（graph-wiki 侧）

- 中心接口已交付并**云端 E2E 通过**（`argo.derekworkspacev5.com`）：授权读 archgraph = 298 元素（`database=archgraph`）、未授权 403、未知成员 403、`memory_search` 语义命中、`mirror_list` 含 archgraph+soc-demo。
- 已建真实副本：**archgraph（298 元素）**、**soc-demo（386 元素）**，各占独立 Neo4j database。
- 关键提交：`ad695c7`（初版）、`1ead05b`（120 代理）、`2e2ced7`（幂等+定时同步）、`44a05ea`（验收测试）、本条刷新提交。

## 10. 契约澄清（回应 ArchGraph issue #1）

1. **状态持久化与"被清空"**：中心的成员/授权（`DATA_DIR/assets/registry/registry.json`）与副本（`DATA_DIR/mirrors` + 各成员 Neo4j database）都**落盘**，**跨重启/重部署保留**（安装器不清理 `DATA_DIR`）。observed 的"变空"是**运维显式执行了一次清空**（按需求重置），不是重启导致。成员若发现 `member_not_found`，应**重新注册**（`registry_register`）并等待副本重建。
2. **注册/同步是长任务**：`registry_register` 现在**立即返回**（`mirror.status="accepted"`，副本在**后台异步**构建）；`mirror_sync` 为长耗时（克隆+投影+embedding，约 0.2–3 分钟）。请**轮询 `mirror_list`** 判断是否就绪，勿依赖单次 MCP 超时。已把 `registry_register` 的 `branch` 加入 schema。
3. **副本是否被 embedding**：是。`mirror_sync` → 镜像引擎调用 ARGO **`buildHarnessReport`（即 `initializeWorkspace` 逻辑）**，含 **semanticLifecycle / embedding 回填**。此前语义读失败是因为当时引擎的 ARGO 配置（`ARGO_EMBEDDING_*`/`ARGO_LIVE_PROVIDER_E2E`）缺失/为空；现已配好，`memory_search` 正常。配置位于 **ARGO 自己的 `~/.argo/.env`**（引擎自动读取）。
4. **自读授权**：已改为**隐式放行**——`requester === projectId`（读自己的副本）无需显式自授权；读他人仍需显式授权（默认拒绝不变）。
5. **授权提交**：`registry_authorize` 的 git 提交此前因中心 git 身份未设而失败（`Author identity unknown`）。已修：提交时带 `-c user.name/user.email`（并把身份写入 `DATA_DIR` git 配置），授权现可正常版本化。
6. **`branch`**：`registry_register` schema 已补 `branch`（文档与实现一致）。

> 注意：以上 3/4/5/6 为本次修复（中心侧），请 ArchGraph 侧按第 2 条改为**轮询**判定同步完成。

## 11. Schema 自动适配（项目 schema 变化无须改中心代码）

中心的图谱校验已改为 **schema 自适应**（`mcp/graph-schema.js`），不再内置 ArchiMate 类型清单：

- **类型校验来源按优先级解析**：`graph.schema`（图自述，或调用方显式传 `schema`）→ 框架解析（传 `projectId`，中心经引擎新增端点 `POST /schema` 让 ARGO 在该成员 workspace 解析）→ **开放模式**（都没有时仅做结构校验，类型语义交给框架权威判定）。
- **封闭 schema 才判非法类型**：自述/框架 schema 默认封闭（可用 `closed:false` / `open:true` 显式开放）；开放模式不查类型。
- **结构校验始终留在中心**：必填字段、id 唯一、关系端点引用、视图成员引用、顶层视图唯一。
- **引擎不可用不阻塞**：`projectId` 对应副本未同步/引擎不可达时回退开放模式，响应标注 `schemaSource:"engine_unavailable"`。
- 因此成员仓改 schema（新增类型、`schemaKind=workspace/override`、自定义 bundle）→ 提交 + `mirror_sync` 重投影即生效；**只有 ARGO 逻辑接口变化**（报告结构、工具名、模块路径、配置键）才需要中心人工适配。

## 12. 可观测与巡检（vlog 打点 → 洞察 → 自愈）

- **打点**：统一 JSONL 到 `GRAPH_STORE_LOG_DIR`（默认 `~/.graph-store/logs`，部署为 `DATA_DIR/logs`）。
  - `engine.ndjson`：`start`（含 argoVersion）、`sync`（status/reason/commit/neo4jOk/semanticOk/durationMs）、`schema`、`read`。
  - `store.ndjson`：`graph_read`（授权结果/拒绝原因/耗时）、`graph_validate`（schemaSource/valid/errors）、`registry`（register/deregister/authorize）。
- **引擎接口**：`GET /health` 增加 `argoVersion`/`logDir`；`GET /mirrors` 增加 `commit`/`syncedAt`/`neo4jOk`/`semanticOk`；新增 `POST /schema {projectId}`（返回该成员框架解析的 schema）。
- **巡检**：`graph-store patrol [--heal]`（部署为 `graph-store-patrol.timer`，每 15 分钟）。聚合洞察：同步/语义/schema 失败、读拒绝率、副本上游漂移（`git ls-remote` 对比 `commit`）、**ARGO 版本变化（框架升级信号）**、schema 兼容冒烟（经 `/schema`）；`--heal` 对 `not ok` 副本触发 `mirror_sync`。异常时退出码非 0；快照写 `patrol-latest.json`。

## 13. 与 ArchGraph 0.27.0-beta.14 对齐（2026-10-04；前次 0.27.0-beta.12 @ 2026-10-03）

上游 dev 版本 `archgraph-argo-beta@0.27.0-beta.14`（stable 仍 `archgraph-argo@0.26.2`；beta.13/.14 相对 beta.12 仅新增上下文输出预算）的契约核对与中心兼容性（实证基于该 npm 包源码）：

| 框架变化 | 中心影响 | 结论 |
|---|---|---|
| schema bundle 命名统一（`argob*`→`schema-bundle*`、内联键 `x-argob`→`x-schema-bundle`、`ARGOB.md`→`GUIDE.md`）| 中心 0 引用、不解析 bundle 文件（由 ARGO 按 `ARGO_SCHEMA_DIR > workspace/.argo/schema > ~/.argo/schema` 解析）| 无需改动 |
| bundle 能力扩展（`attributesByElementType`/`extends`/mtime 缓存失效）| 由 ARGO 写入路径原生执行；中心仅经 `/schema` 读解析结果 | 自动适配 |
| `queryNeo4jGraph {schema:true}` 返回键 | beta 仍返回 `schema.archimateElementTypes/RelationshipTypes/schemaKind/schemaLanguage` | 引擎 `/schema` 兼容 |
| MCP `structuredContent`（跨项目）| 由消费侧（框架本地 MCP）依 `outputSchema` 构建；中心 `/graph/read` 契约与 beta 客户端 `external-graph-query.js` 逐行一致（`{status:'ok', result, namespaceKey}` / `{status:'denied', reason}`，客户端自行解包 `content[0].text`）| 无需改动 |
| 实体 id 自动分配（slug + `allocatedId`）| 镜像只读、id 原样流转；`graph_submit/graph_update` 的资产校验仍要求显式 id（框架落盘 canonical JSON 前已分配）| 兼容 |
| 上下文输出预算（`maxBytes`/`truncation`）| `getIntentElementContext`/`getArchitectureViewContext` 新增可选 `maxBytes`（默认 32000，`0`=不限）；超限将非焦点成员降级为 id/type/name 并在 `truncation` 给出完整 id 清单（beta.14 增 `overBudgetByFocus`）；`ARGO_CONTEXT_MAX_BYTES` 列入 host-only env 白名单。中心只透传 `args` 与结果、不做改写 | 自动适配（回归 `tests/acceptance/context_budget_passthrough.js`）|
| DSH 联邦接入 `argo/mcp-bridges/graph-mcp-stdio.js` | 框架包提供 | onboarding 文档 |
| 联邦命名统一 | 文案统一为「联邦式意图图谱（Federated Intent Graph = Registry–Broker Federation over sovereign knowledge graphs）」| 已更新 |

中心侧验收（GIVEN-WHEN-THEN）：

1. GIVEN 拉取 `archgraph` 的 `develop-separate-schema` 分支镜像，WHEN `mirror_sync`，THEN `mirror_list` 报 `synced:true/ok:true` —— ✅ 已于 2026-10-03 达成：`commit=ee0987a`、`branch=develop-separate-schema`、`neo4jOk/semanticOk=true`（并修复了阻断它的 fetch refspec 生产缺陷）。
2. GIVEN 跨项目 `getSystemArchitecture({ projectId })`（经 beta 客户端），WHEN 读取，THEN 返回含 `namespaceKey` 的结果且无 `-32600` —— ✅ 实测通过（见 issue #3 评论）。
3. GIVEN 上游图中存在服务端自动分配的 slug id 元素，WHEN 经中心跨项目读取，THEN 正常按引用返回（含 `namespaceKey`）—— ✅ 读路径对 id 不透明处理，回归用例 `tests/acceptance/beta_contract.js`。

> 版本通道：镜像宿主引擎经金丝雀验证后已切至 **beta**（2026-10-03 切 beta.12；2026-10-04 切 beta.14），当前 `ARGO_ROOT=/root/.argo-beta`、`ARGO_VERSION=0.27.0-beta.14`；回滚=恢复 `argo-mirror-engine.service.stable-backup`（stable 0.26.2）或上一 beta 备份并重启（`ARGO_NPM_PACKAGE` 作为切换开关）。
