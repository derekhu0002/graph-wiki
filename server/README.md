# 总知识图谱远端服务部署

graph-wiki 作为总知识图谱管理中心，通过部署在远程服务器上的 **ARGO MCP HTTP/SSE 网关**
向各项目提供知识图谱的查询与贡献能力。

## 架构

```
知识消费/贡献项目 (各项目 Agent/应用)
        │  MCP over HTTP/SSE (JSON-RPC)
        ▼
Nginx 反向代理 (argo.derekworkspacev5.com/mcp)
        │  proxy_pass 127.0.0.1:18789
        ▼
ARGO MCP HTTP/SSE 网关 (server/argo-mcp-http-gateway.js, systemd: argo-mcp-gateway)
        │
        ├── 读取总图谱 canonical JSON (design/KG/SystemArchitecture.json)
        ├── Neo4j 投影 + embedding 语义检索 (~/.argo/.env 配置)
        └── ARGO MCP 工具集 (19 个工具: 读/写/验证/检索/验收测试)
```

## 文件

| 文件 | 说明 |
|---|---|
| `server/argo-mcp-http-gateway.js` | HTTP/SSE 网关服务（复用 ARGO MCP server 的 JSON-RPC 处理） |
| `server/deploy-remote.sh` | 远程服务器一键部署脚本 |
| `server/nginx-kg-mcp.conf` | Nginx 反向代理配置模板 |

## 本地启动（验证）

```bash
export KG_ARGO_ROOT="$HOME/.argo"     # ARGO 工具链位置
export ARGO_REPO_ROOT=/path/to/graph-wiki  # 总图谱仓库根
node server/argo-mcp-http-gateway.js  # 监听 127.0.0.1:18789
```

健康检查: `curl http://127.0.0.1:18789/health`

## 远程部署

```bash
bash server/deploy-remote.sh root@120.24.114.13
```

部署脚本完成:
1. 同步 ARGO 工具链到服务器 `~/.argo`
2. 同步总图谱仓库到服务器 `/opt/graph-wiki`
3. 安装 Node 依赖
4. 配置并启动 systemd 服务 `argo-mcp-gateway`
5. 配置 Nginx 反向代理并重载

## 客户端接入

各项目在 opencode / MCP 客户端中配置远端 MCP:

```json
{
  "mcp": {
    "argo-kg": {
      "type": "remote",
      "url": "https://argo.derekworkspacev5.com/mcp",
      "enabled": true
    }
  }
}
```

或直接使用网关地址（内网）: `http://<server>:18789/mcp`

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `KG_MCP_PORT` | 网关监听端口 | 18789 |
| `KG_MCP_HOST` | 网关监听地址 | 127.0.0.1 |
| `KG_ARGO_ROOT` | ARGO 工具链根目录 | 自动向上查找 |
| `ARGO_REPO_ROOT` | 总图谱仓库根 | 自动检测 |
| `ARGO_ENV_FILE` | Argo 环境文件 (Neo4j/embedding) | `~/.argo/.env` |
