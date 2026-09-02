# 图谱资产 MCP 服务

轻量的远程 MCP HTTP/SSE 服务，供本机各 AI AGENT 查询、获取、提交**图谱资产**。
参考 teamai-cli 的思路：Git 仓库管理 + MCP 服务分发，但资产统一为整张
ARCHGRAPH 图谱（不是独立单文件）。

## 服务端点

| 端点 | 说明 |
|---|---|
| `https://argo.derekworkspacev5.com/mcp` | MCP 端点（公网，HTTPS） |
| `http://127.0.0.1:18792/mcp` | 内网端点（服务器本机） |
| `https://argo.derekworkspacev5.com/health` | 健康检查 |

## 工具

| 工具 | 说明 |
|---|---|
| `graph_list` | 列出图谱资产 |
| `graph_get` | 获取一张图谱资产（元数据 + 完整 ARCHGRAPH 图谱） |
| `graph_submit` | 提交新图谱资产（内部自动 schema 校验，不通过则拒收不入库） |
| `graph_update` | 更新图谱资产（内部自动 schema 校验，不通过则拒收不入库） |

> 所有写入接口内部自动执行 ARCHGRAPH schema 校验（结构完整性、ArchiMate 类型
> 合法性、id 唯一、关系端点引用存在、view 成员存在、顶层视图唯一）。
> 校验不通过则返回错误并停止入库。变更入口唯一化，不支持外部直接写文件。

## 接入方式

### OpenCode（本机）

在 `~/.config/opencode/opencode.json` 的 `mcp` 块添加：

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

### 其他 MCP 客户端（Claude / Cursor / Codex 等）

配置一个 http 传输的 MCP server，url 指向 `https://argo.derekworkspacev5.com/mcp`。

## 图谱资产格式

一张图是一个对象：`{ name, description, elements[], relationships[], views[] }`：

```json
{
  "name": "AI组织资产协作图谱",
  "description": "把组织资产串成的关系图谱",
  "elements": [
    { "id": "proj-a", "name": "项目A", "type": "Business Actor" },
    { "id": "skill-x", "name": "构建技能", "type": "Skill" }
  ],
  "relationships": [
    { "id": "r1", "type": "Association", "source_id": "proj-a", "target_id": "skill-x",
      "source_name": "项目A", "target_name": "构建技能",
      "statement": "项目A --(Association)--> 构建技能" }
  ],
  "views": [
    { "view_id": "v1", "view_name": "协作视图", "parent_element_id": "proj-a",
      "included_elements": ["proj-a", "skill-x"] }
  ]
}
```

## 使用示例（Agent 视角）

```
# 开工前获取
1. graph_list            → 看有哪些图谱资产
2. graph_get {id}        → 获取整张图谱作为上下文/基线

# 贡献图谱
3. graph_submit {id} --graph {...}  → 提交（内部校验，不过拒收）
4. graph_update {id} --graph {...}  → 更新（内部校验）
```

## 部署

```bash
# 远程部署（含 systemd 服务 + Nginx 反代）
bash mcp/deploy-asset-mcp.sh root@120.24.114.13
```

远程服务:
- systemd: `asset-mcp`
- 资产根: `/opt/graph-wiki/assets`（Git 仓库管理）
- 提交: 每次 graph_submit/graph_update 自动 git commit

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `ASSET_MCP_PORT` | 监听端口 | 18792 |
| `ASSET_MCP_HOST` | 监听地址 | 127.0.0.1 |
| `ASSET_REPO_ROOT` | 仓库根（含 assets/ 和 .git） | 自动检测 |
| `ASSET_ROOT` | 资产根目录 | `<repo>/assets` |
| `ASSET_GIT_DIR` | git 提交目录 | `<repo>` |
