# 跨项目图谱查询：Graph 项目（ArchGraph 框架）适配需求说明书

> 状态：已交付（中心侧 commit `ad695c7`）
> 面向：ArchGraph 框架项目（下称「Graph 项目」）
> 目的：说明 Graph 项目的 ARGO MCP 需要做的适配，使任一项目的 Agent 在查询时可携带一个外部项目 ID，读取外仓知识图谱；不携带时保持本仓行为不变。

## 1. 背景与目标

Graph Store（graph-wiki 中心）已交付「跨项目图谱查询」：中心托管成员经 **push/merge 审核**后开放的图谱**可用性副本**，并按项目 ID 提供**授权后只读**的查询接口。成员仓仍是事实源，中心不改写成员仓。

Graph 项目作为 Agent 侧入口，需要让所有**数据查询/检索接口**支持一个可选 `projectId`：缺省=本仓，提供=外仓。二者之间**唯一的交汇**是：Graph 项目的查询在命中外仓时调用中心 REST 接口，由中心完成授权校验与副本查询；两个 MCP 之间**没有直接代码耦合**。

## 2. 术语

- **中心 / Graph Store**：graph-wiki 提供的远程服务（MCP + REST）。
- **projectId**：联邦成员全局唯一身份，注册时由中心确认唯一。
- **requester**：发起读取的项目自身 `projectId`。
- **本仓 / 外仓**：本项目的图谱 / 被查询的那个外部项目的图谱。

## 3. 已就绪的中心接口（graph-wiki 侧，已交付）

### 3.1 REST（推荐 Graph 项目直接调用）

```
POST https://argo.derekworkspacev5.com/graph/read
Content-Type: application/json
```

请求体：

```json
{
  "requester": "<self projectId>",
  "projectId": "<target projectId>",
  "op": "overview | elements | element | neighbors | views | search",
  "id": "可选，element/neighbors 用",
  "type": "可选，elements 用（ArchiMate 类型过滤）",
  "text": "可选，search 用",
  "limit": "可选，search 默认 10",
  "depth": "可选，neighbors 默认 1",
  "contentId": "可选，授权粒度，缺省 *"
}
```

成功（HTTP 200）：

```json
{
  "status": "ok",
  "requester": "...",
  "projectId": "...",
  "namespaceKey": "proj:<projectId>",
  "version": "<成员仓 git commit>",
  "syncedAt": "<ISO 时间>",
  "result": { "...": "按 op 返回" }
}
```

拒绝（HTTP 403）与错误（HTTP 400）：

```json
{ "status": "denied", "reason": "not_authorized | member_not_found | mirror_not_synced", "requester": "...", "projectId": "..." }
{ "status": "bad_request", "reason": "missing_requester_or_projectId | unknown_op:... | ..." }
```

`op` 语义：

| op | 入参 | 返回 |
|---|---|---|
| `overview` | — | `stats`（elements/byType/views 计数） |
| `elements` | `type?` | `count` + `elements[]`（id/name/type/description） |
| `element` | `id` | `element` + `relationships[]`（邻接） |
| `neighbors` | `id`, `depth?` | `nodes[]` + `edges[]` |
| `views` | — | `views[]`（view_id/view_name/parent_element_id/members） |
| `search` | `text`, `limit?` | `results[]`（相似度排序，带 score） |

### 3.2 MCP 工具（与 REST 同源）

`graph_read_external { requester, projectId, op, id?, type?, text?, limit?, depth?, contentId? }` —— 同一业务入口，供 MCP 客户端使用。

### 3.3 管理与授权（Graph MCP，供所有者 / 运维）

| 工具 | 用途 |
|---|---|
| `registry_register { id, name, role, capabilities, openContent, sourceRepo, branch }` | 注册；中心确认 `id` 唯一；同 id 来自不同 `sourceRepo` 会被拒绝 |
| `registry_authorize { grantor, grantee, contentId }` | 所有方授权请求方；`contentId` 缺省 `*` |
| `mirror_sync { projectId }` | 中心按成员已审核分支同步副本（投影 + 向量化） |
| `registry_deregister { id }` | 注销并移除中心副本、回收授权 |

## 4. Graph 项目需要适配的内容（需求）

### FR-G1 获取并持久化本仓 projectId（前置）

- 首次接入：调用 `registry_register` 完成注册，把中心确认的 `id` 作为本仓 `projectId`。
- **本地持久化**到工作区，例如 `.argo/federation.json`：
  ```json
  { "projectId": "<id>", "sourceRepo": "<repo>", "centerUrl": "https://argo.derekworkspacev5.com", "branch": "main", "registeredAt": "<ISO>" }
  ```
- ARGO MCP 启动/外仓查询时读取该文件得到 **self projectId**，用于填 `requester`；**文件缺失时必须报错并提示先注册，不得猜测或留空**。

### FR-G2 查询/检索工具新增可选参数 `projectId`

- 所有数据查询与检索工具（如 `getSystemArchitecture` / `getIntentElementContext` / `getArchitectureViewContext` / `queryNeo4jGraph` / `memory_search`）新增可选参数 `projectId`。
- 语义：
  - **缺省** → 本仓（现有行为、返回结构、性能**逐字节不变**）。
  - **提供** → 视为外仓：转发到中心 `POST /graph/read`，`requester` 填本仓 `projectId`，`projectId` 填该参数；`op` 由工具自身语义映射（见 §5 映射建议）。
- 建议在 MCP 服务内集中一个 **Graph Query Router** 层实现，避免逐个工具散改逻辑。

### FR-G3 结果与错误透传

- 成功：把中心 `result` 映射回工具原有返回结构（对调用方尽量透明），并附带 `version` / `syncedAt`。
- 失败：`denied` 时返回明确原因（`not_authorized` / `member_not_found` / `mirror_not_synced`）；**不得静默降级为本仓结果**。

### FR-G4 本仓零回归

- 不传 `projectId` 时，工具行为、返回结构、性能与现状一致。

## 5. op 映射建议（工具 → 中心 op）

| ARGO MCP 工具 | 中心 op | 传参 |
|---|---|---|
| `getSystemArchitecture` | `search` 或 `overview` | `text`=intent / 无 |
| `getIntentElementContext` | `neighbors` 或 `element` | `id`, `depth` |
| `getArchitectureViewContext` | `views` / `elements` | — |
| `queryNeo4jGraph`（结构查询） | `elements` / `element` / `neighbors` | `type` / `id` |
| `memory_search`（语义检索） | `search` | `text`, `limit` |

> 说明：中心副本的向量化当前为**纯 Node 本地哈希向量**（`vectors.json`），可替换为真实 embedding，`search` 的返回形状不变。

## 6. 边界与限制

- **demo 阶段无强身份认证**：`requester` 为自称，安全性依赖网络与授权记录，勿对外承诺强安全。
- **只读**：不得经该接口写外仓。
- **新鲜度**：副本按中心同步策略更新，跨项目结果以返回的 `version` 为准。
- 跨项目查询与 `registry_read`（返回引用）**互不复用、各自独立**。

## 7. 验收（GIVEN-WHEN-THEN）

1. **本仓不变**：GIVEN 不传 `projectId`，WHEN 查询任一工具，THEN 与本仓现状一致。
2. **外仓授权读**：GIVEN 已注册并持久化 `projectId`、中心已托管目标副本且已授权，WHEN 带 `projectId` 查询，THEN 返回目标项目结果与 `version`。
3. **默认拒绝**：GIVEN 未获授权，WHEN 带 `projectId` 查询，THEN 明确返回 `denied / not_authorized`，不降级。
4. **身份缺失**：GIVEN 本地无联邦身份，WHEN 发起外仓查询，THEN 报错提示先注册（不猜测 `requester`）。

## 8. 依赖与交付

- 中心接口已交付：commit `ad695c7`（graph-wiki）。
- Graph 项目需交付：本地身份文件读写 + 查询工具 `projectId` 路由 + 可执行验收（≥ 上表 4 条）。
