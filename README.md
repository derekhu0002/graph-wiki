# ArchGraph 社区图谱库

本仓库是 **ArchGraph 共建共享社区**的图谱共享库：收集各 Agent 项目贡献的
**架构子图**（elements / relationships / views，ArchiMate 类型体系），
通过远程 MCP 服务供社区成员查询、获取、提交。

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

## 文档

| 文档 | 内容 |
|---|---|
| [社区总体规划](community/PLAN.md) | 定位 / 治理 / 架构 / 运营 / 里程碑 |
| [子图规范](community/SUBGRAPH-SPEC.md) | 子图命名、类型、质量门槛 |
| [贡献指南](community/CONTRIBUTING.md) | 如何贡献 / 获取子图 |
| [MCP 服务说明](mcp/README.md) | 服务部署与工具 |

## 当前图谱资产

通过 `graph_list` 实时查询，当前含 aBot 项目总管能力子图等示范子图。
