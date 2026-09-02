# AI 组织资产 MCP 服务

轻量的远程 MCP HTTP/SSE 服务，供本机各 AI AGENT 查询、获取、提交 AI 组织资产。
参考 [teamai-cli](https://github.com/Tencent/teamai-cli) 的做法：Git 仓库管理资产 + MCP 服务分发。

## 服务端点

| 端点 | 说明 |
|---|---|
| `https://argo.derekworkspacev5.com/mcp` | MCP 端点（公网，HTTPS） |
| `http://127.0.0.1:18792/mcp` | 内网端点（服务器本机） |
| `https://argo.derekworkspacev5.com/health` | 健康检查 |

## 工具

| 工具 | 说明 |
|---|---|
| `asset_list` | 列出资产（可按 `type` 过滤） |
| `asset_get` | 获取单个资产（元数据 + 内容） |
| `asset_search` | 关键词搜索资产 |
| `asset_register` | 登记/提交新资产（写文件 + 更新 catalog.json + git commit） |
| `asset_update` | 更新资产（内容/版本/描述 + git commit） |
| `asset_types` | 列出资产类型与目录映射 |
| `graph_list` | 列出图谱资产 |
| `graph_get` | 获取一张图谱资产（元数据 + 完整 ARCHGRAPH 图谱） |
| `graph_validate` | 校验一张 ARCHGRAPH 图谱（提交前自检） |
| `graph_submit` | 提交新图谱资产（schema 校验 + 写入 + catalog + git commit） |
| `graph_update` | 更新图谱资产（schema 校验 + git commit） |

资产类型: `AGENT` / `SKILL` / `RULE` / `HOOKS` / `KNOWLEDGE` / `GRAPH`，分别对应
`assets/agents/` `assets/skills/` `assets/rules/` `assets/hooks/` `assets/knowledge/` `assets/graphs/`。

> **图谱资产**：`GRAPH` 类型是一张完整的 ARCHGRAPH 图谱（`elements`/`relationships`/`views`，
> ArchiMate 元素/关系类型体系），存为 `assets/graphs/<id>/graph.json`。
> 提交时自动做 schema 校验：结构完整性、ArchiMate 类型合法性、id 唯一、关系端点存在。
> 独立资产（AGENT/SKILL/RULE 等）与图谱资产（把元素串成的关系图）都可共建共享。

> 变更入口唯一化：所有资产变更必须通过 `asset_register` / `asset_update` / `graph_submit` / `graph_update`
> 完成（内部自动 git commit）。不支持外部直接写 `assets/` 文件。

## 接入方式

### OpenCode（本机）

在 `~/.config/opencode/opencode.json` 的 `mcp` 块添加：

```json
{
  "mcp": {
    "asset-mcp": {
      "type": "remote",
      "url": "https://argo.derekworkspacev5.com/mcp",
      "enabled": true
    }
  }
}
```

### 其他 MCP 客户端（Claude / Cursor / Codex 等）

配置一个 http 传输的 MCP server，url 指向 `https://argo.derekworkspacev5.com/mcp`。

## 使用示例（Agent 视角）

```
# 开工前获取资产
1. asset_list           → 查看有哪些组织资产
2. asset_list --type SKILL → 只看技能
3. asset_get {id}       → 获取资产内容
4. asset_search "rule"  → 关键词搜索

# 贡献独立资产
5. asset_register {id} --type SKILL --name ... --content ...
6. asset_update {id} --version 1.1.0

# 图谱资产（整张 ARCHGRAPH 图谱，元素串成关系图）
7. graph_validate {graph}          → 提交前自检 schema
8. graph_list                      → 看有哪些图谱资产
9. graph_get {graphId}             → 获取整张图
10. graph_submit {id} --graph {...} → 提交一张完整图谱（elements/relationships/views）
11. graph_update {id} --graph {...} → 更新图谱
```

## 部署

```bash
# 远程部署（含 systemd 服务 + Nginx 反代）
bash mcp/deploy-asset-mcp.sh root@120.24.114.13
```

远程服务:
- systemd: `asset-mcp`
- 资产根: `/opt/graph-wiki/assets`（Git 仓库管理）
- 提交: 每次 register/update 自动 git commit

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `ASSET_MCP_PORT` | 监听端口 | 18792 |
| `ASSET_MCP_HOST` | 监听地址 | 127.0.0.1 |
| `ASSET_REPO_ROOT` | 仓库根（含 assets/ 和 .git） | 自动检测 |
| `ASSET_ROOT` | 资产根目录 | `<repo>/assets` |
| `ASSET_GIT_DIR` | git 提交目录 | `<repo>` |
