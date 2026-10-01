# ArchGraph 社区图谱库

本仓库是 **ArchGraph 共建共享社区**的图谱共享库：收集各 Agent 项目贡献的
**架构子图**（elements / relationships / views，ArchiMate 类型体系），
通过远程 MCP 服务供社区成员查询、获取、提交，并以**联邦注册中心**登记成员、
按引用互相读取开放子图。

## 相关仓库

| 仓库 | 说明 |
|---|---|
| [archgraph](https://github.com/derekhu0002/archgraph) | ArchGraph 框架（意图图驱动 Agentic Engineering） |
| **本仓库 (graph-wiki)** | 社区图谱共享库 + 远程 MCP 服务 |

## 快速开始

### 接入（Agent 使用）

在 opencode.json / MCP 客户端配置远程服务：

```json
{
  "mcp": {
    "graph-mcp": {
      "type": "remote",
      "url": "https://argo.derekworkspacev5.com/mcp",
      "enabled": true
    }
  }
}
```

### 查/取子图

```
graph_list                                        # 看社区子图
graph_get { id: "abot-overseer-capability-001" }  # 获取整张图
```

### 贡献子图

```
graph_submit { id: "<project>-<domain>-<type>-<seq>", graph: {...} }  # 提交（自动 schema 校验）
graph_update { id: "...", graph: {...}, version: "1.1.0" }            # 更新
```

### 联邦协作（成员与授权）

```
registry_discover                                      # 发现已注册的联邦成员
registry_authorize { grantor, grantee, contentId }     # 成员显式授权
registry_read { requester, member }                    # 授权后按引用读取（默认拒绝）
```

### 跨项目图谱查询（副本托管）

```
mirror_sync { projectId }                              # 同步成员已审核仓 → 投影+向量化
graph_read_external { requester, projectId, op }       # 授权后查询托管副本（默认拒绝）
# 或 REST: POST https://argo.derekworkspacev5.com/graph/read
```

中心托管成员经 **push/merge 审核**后开放的图谱**可用性副本**（复用 ARGO 引擎做 Neo4j 投影 + Qwen 向量化）；
成员仓仍是事实源，副本按 git 版本同步。**每个成员一个独立 Neo4j database**（= `projectId`），查询不跨图。
活体授权读取（`registry_read`）仍按引用、不传副本。
人读入口：[联邦成员页](https://argo.derekworkspacev5.com/archgraph/federation)。

## 部署与迁移（标准流程）

以 **NPM 包 `graph-store`** 交付：**服务器上安装 + 一条命令部署**（详见 [deploy/README.md](deploy/README.md)）。
一次部署同时起：Graph Store（`/mcp`、`/graph/read`）、社区网站（`/archgraph/`）、ARGO 镜像引擎（Neo4j + embedding）、定时重同步。

```bash
npm i -g graph-store
cp "$(npm root -g)/graph-store/deploy/graph-store.env.example" ./graph-store.env
vi ./graph-store.env                       # 必填 QWEN_KEY、NEO4J_PASSWORD；可选 GITHUB_TOKEN、ARGO_RERANK_API_KEY
graph-store deploy --config ./graph-store.env
# 本地: http://127.0.0.1:18792/mcp 与 /graph/read；网站 http://127.0.0.1:18793/archgraph/
```

- **绑定与职责**：服务只绑本地/私网端口；**对外反代 / 域名 / TLS 由 IT 负责**，且网站与 `/mcp` 必须**同源**
  （`/archgraph/` → 网站端口，`/mcp`·`/graph/read`·`/health` → 服务端口）。
- **迁移**：新机重复上述安装；迁移 `assets/registry/registry.json`（成员+授权）后 `mirror_sync` 重建副本。
- **秘密**：`QWEN_KEY`/`NEO4J_PASSWORD` 等只落在 `~/.argo/.env` 与 `DATA_DIR/graph-store.env`（600），不入仓库。

> **部署运行规则**（务必遵守，踩坑后固化）：① Graph Store 的引擎配置写**我们自己的** `DATA_DIR/argo.env`（systemd 注入进程环境给 ARGO 引擎），**不写 ARGO 的 `~/.argo/.env`**（ARGO 的归 ARGO，Graph Store 的归 Graph Store）；且 `ARGO_LIVE_PROVIDER_E2E`
> 与 `ARGO_W31_LIVE_MUTATION_VECTOR_E2E` 必须同时 `=1`（否则 embedding 不执行）——**不要**设 `ARGO_ENV_FILE`（会被 ARGO provenance 校验拒绝）；② 改配置后 `systemctl restart`（`enable --now` 不重启）；③ Neo4j 用 **Enterprise**（多库，一成员一库）；④ 详见 [deploy/README.md](deploy/README.md) 与 KG 规则 `kb-rule-deploy-runbook`。

换服务器只改配置；Graph 项目侧按 [Graph 项目配置化适配需求](community/GRAPH-PROJECT-CONFIG-ADAPTATION.md) 配置「中心地址」即可访问新实例。

## 文档

| 文档 | 内容 |
|---|---|
| [社区总体规划](community/PLAN.md) | 定位 / 治理 / 架构 / 运营 / 里程碑 |
| [子图规范](community/SUBGRAPH-SPEC.md) | 子图命名、类型、质量门槛 |
| [贡献指南](community/CONTRIBUTING.md) | 如何贡献 / 获取子图 |
| [MCP 服务说明](mcp/README.md) | 服务部署与工具 |
| [部署与迁移](deploy/README.md) | 一键安装、迁移、拆分部署 |
| [Graph 项目适配说明书](community/EXTERNAL-GRAPH-QUERY-ADAPTATION.md) | 跨项目查询接口与调用契约 |
| [Graph 项目配置化适配需求](community/GRAPH-PROJECT-CONFIG-ADAPTATION.md) | 地址分层配置 / 跨仓 / 可复制 |

## 当前图谱资产

通过 `graph_list` 实时查询。截至 2026-09-25，社区已注册 **2 个联邦成员**
（[ArchGraph 框架](https://github.com/derekhu0002/archgraph)、
[SOC-DEMO](https://github.com/derekhu0002/SOC-DEMO)），共享 **10 张图谱资产**
（如 aBot 项目总管能力子图、KG-LMT 长期记忆治理模式、洞察研究团队子图、
架构图谱组织元模型等示范子图，含个别已弃用标记）。成员与授权见
[联邦成员页](https://argo.derekworkspacev5.com/archgraph/federation)。
