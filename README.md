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

中心只保存**成员元数据与授权**，不保存内容副本；各成员图谱保持主权。
人读入口：[联邦成员页](https://argo.derekworkspacev5.com/archgraph/federation)。

## 文档

| 文档 | 内容 |
|---|---|
| [社区总体规划](community/PLAN.md) | 定位 / 治理 / 架构 / 运营 / 里程碑 |
| [子图规范](community/SUBGRAPH-SPEC.md) | 子图命名、类型、质量门槛 |
| [贡献指南](community/CONTRIBUTING.md) | 如何贡献 / 获取子图 |
| [MCP 服务说明](mcp/README.md) | 服务部署与工具 |

## 当前图谱资产

通过 `graph_list` 实时查询。截至 2026-09-25，社区已注册 **2 个联邦成员**
（[ArchGraph 框架](https://github.com/derekhu0002/archgraph)、
[SOC-DEMO](https://github.com/derekhu0002/SOC-DEMO)），共享 **10 张图谱资产**
（如 aBot 项目总管能力子图、KG-LMT 长期记忆治理模式、洞察研究团队子图、
架构图谱组织元模型等示范子图，含个别已弃用标记）。成员与授权见
[联邦成员页](https://argo.derekworkspacev5.com/archgraph/federation)。
