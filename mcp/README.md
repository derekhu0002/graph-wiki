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
| `asset_commit` | 手动 git 提交资产变更 |
| `asset_types` | 列出资产类型与目录映射 |

资产类型: `AGENT` / `SKILL` / `RULE` / `HOOKS` / `KNOWLEDGE`，分别对应
`assets/agents/` `assets/skills/` `assets/rules/` `assets/hooks/` `assets/knowledge/`。

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

# 贡献资产
5. asset_register {id} --type SKILL --name ... --content ...
6. asset_update {id} --version 1.1.0
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
