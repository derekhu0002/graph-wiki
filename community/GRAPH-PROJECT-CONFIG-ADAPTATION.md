# Graph 项目配置化适配需求说明书（跨仓查询 · 地址配置 · 可复制部署）

> 状态：待 Graph 项目实现
> 面向：ArchGraph 框架项目（下称「Graph 项目」）
> 关联：《跨项目图谱查询：Graph 项目适配需求说明书》（`EXTERNAL-GRAPH-QUERY-ADAPTATION.md`，接口与调用契约在彼）
> 目的：把「跨项目图谱查询」从**硬编码**升级为**可配置、可复制**：换一台服务器、换一个中心地址，只改配置不改代码。

## 1. 背景

Graph Store（graph-wiki）已提供跨项目图谱查询：REST `POST {center}/graph/read`（`{ requester, projectId, tool, args }`）+ Graph MCP（`registry_register/authorize/discover`、`graph_read_external`、`mirror_*`）。Graph 侧已能调用。

为了**整套能力可复制**（把 store 部署到任意服务器、Graph 项目适配新地址即可用），Graph 侧需要把「中心地址 / 外仓查询」做成**分层可配置**，而不是写死某个 URL。

## 2. 现状审视（可复制性）

- **Store 侧**：`deploy/install-graph-store.sh`（本仓库新增）可在新服务器**下载仓库 + 一键安装**：Node + ARGO 引擎 + Neo4j（docker）+ 镜像引擎服务 + Store 服务 + 定时同步 + 可选 Nginx；对外 URL/域名由配置决定。默认支持**本机 127.0.0.1** 访问。
- **Graph 侧**：已能调用接口，但**中心地址需可配置**，否则每换环境都要改代码。→ 本需求。

## 3. 需求

### FR-C1 跨仓 / 外仓支持（环境变量可配）

- ARGO MCP 支持「外仓查询」：给定 `projectId` 时经中心 `POST {center}/graph/read` 查询（tool/args 与本地工具同名同参），缺省=本仓。
- 中心地址**来自环境变量**（可由项目/运维自行配置），不写死。建议键名（可自定）：
  - `GRAPH_STORE_URL`（中心基址，如 `https://argo.derekworkspacev5.com`）
  - 或 `XG_CENTER_URL`。
- 未配置或不可达时：外仓查询给出**明确错误**，本仓查询不受影响。

### FR-C2 项目内配置（不同项目 → 不同中心）

- 允许**每个项目拥有自己的中心地址**（多中心并存，例如各团队自建 store）。
- 支持项目**工作区级配置文件**（示例：`<repo>/.argo/federation.json` 或 `<repo>/opencode.json` 的 `graphStore.url`），由该项目自主填写其中心地址。
- 同一台机器上不同项目可指向不同中心，互不影响。

### FR-C3 地址配置（默认 + 覆盖，分层）

- **默认**：使用**用户级默认地址**（如 `~/.config/opencode/graph-store.json` 或 `~/.argo/.env` 中的默认中心 URL）。
- **覆盖**：若项目本地配置了地址，则使用该项目对应的地址。
- **优先级**：`项目本地配置 > 用户级默认`；两者都缺 → 报错并提示如何配置（不得猜测）。
- 与本机部署契合：本机同时跑 store 时，项目可只配 `http://127.0.0.1:<port>` 即可访问。

### FR-C4 身份与调用（承接上一份说明书）

- `requester` = 本仓 `projectId`，来自本地身份（注册后写回）。
- 注册/授权经 Graph MCP；外仓查询经 `POST {center}/graph/read`。

## 4. 验收（GIVEN-WHEN-THEN）

1. **env 生效**：GIVEN 仅设置环境变量中心地址，WHEN 外仓查询，THEN 走该地址且成功。
2. **项目本地优先**：GIVEN 用户默认地址=A、项目本地配置=B，WHEN 该项目外仓查询，THEN 走 B。
3. **回退默认**：GIVEN 仅用户默认地址存在，WHEN 项目未本地配置，THEN 走用户默认。
4. **缺失报错**：GIVEN 两处都无地址，WHEN 外仓查询，THEN 明确报错提示配置，不猜测、不静默降级。
5. **本仓不变**：GIVEN 不传 projectId，WHEN 查询，THEN 与本仓现状一致。

## 5. 交付物

- Graph 项目：中心地址的**分层配置**实现（env + 项目本地 + 用户默认）+ 外仓路由 + 上述 5 条可执行验收。
- graph-wiki：`deploy/` 一键安装脚本 + 配置模板（已在仓库）。
