# Graph Store 部署与迁移

把「Graph Store（联邦注册中心 + 跨项目图谱查询）+ ARGO 镜像引擎」部署到任意 Linux 服务器。
**做成 NPM 包 `graph-store`**：服务器上 `npm i -g` + 一条 `graph-store deploy` 即可；换服务器、换域名只改配置。

## 0. 前提

- Linux（Ubuntu 22.04+ 验证）、`docker`、`systemd`、可 `root`。
- 出网可达：npm 镜像（安装 ARGO 引擎）、embedding 端点（阿里 Qwen）。
- 若成员仓为私有：准备一个**只读 Git Token**（`GITHUB_TOKEN`）。

## 1. 发布与安装（NPM 形态）

维护者发布：

```bash
npm publish            # 发布 graph-store（如命名冲突，用 @scope/graph-store）
```

服务器安装并部署：

```bash
npm i -g graph-store@<version>
cp <pkg>/deploy/graph-store.env.example graph-store.env   # 或直接编辑后 --config 指定
vi graph-store.env     # 填 NEO4J_PASSWORD、QWEN_KEY、（可选）GITHUB_TOKEN
graph-store deploy --config ./graph-store.env
# 或：graph-store deploy（读取包内 deploy/graph-store.env）
```

本地即可访问（默认 `127.0.0.1`，同机项目直接用）：

```
MCP :  http://127.0.0.1:18792/mcp
REST:  http://127.0.0.1:18792/graph/read
```

> 代码在包目录（`$(npm root -g)/graph-store`），可写数据在 `DATA_DIR`（默认 `/opt/graph-store`）。

## 1b. 从源码部署（等价）

```bash
git clone <repo> && cd graph-wiki
cp deploy/graph-store.env.example deploy/graph-store.env
vi deploy/graph-store.env          # 至少填 NEO4J_PASSWORD、QWEN_KEY、（可选）GITHUB_TOKEN
sudo bash deploy/install-graph-store.sh
```

安装脚本会：装 Node（缺则装）→ 装 ARGO 引擎 + 写 `~/.argo/.env`(600) → 起 Neo4j（Enterprise，支持多库）
→ 装并启动 systemd 单元（`asset-mcp`、`argo-mirror-engine`、`sync-mirrors.timer`）→ 健康检查。

MCP 客户端配置（本机项目）：

```json
{ "mcp": { "graph-mcp": { "type": "remote", "url": "http://127.0.0.1:18792/mcp", "enabled": true } } }
```

## 2. 对外访问（由 IT 负责，不在本项目范围）

本项目只把**服务**与**网站**绑到本地端口，**不负责**反向代理 / 域名 / TLS：

- Graph Store：`127.0.0.1:18792`（`/mcp`、`/graph/read`、`/health`）
- 社区网站：`127.0.0.1:18793`（静态站，base `/archgraph/`）

如需对外，由 IT 在**同一域名**下反代（**网站与 `/mcp` 必须同源**，因为浏览器里网站直接调 `/mcp`）：

| 路径 | 反代到 |
|---|---|
| `/archgraph/`（网站） | 网站端口 18793 |
| `POST /mcp` | 服务端口 18792 |
| `POST /graph/read` | 服务端口 18792 |
| `GET  /health` | 服务端口 18792 |

参考片段见 `deploy/nginx-graph-store.conf.template`（供 IT 复制，安装器**不再**自动写入 Nginx）。
若由外部代理直连本机端口，可将 `GRAPH_STORE_HOST`/`WEB_HOST` 设为 `0.0.0.0` 或内网 IP。

> 网站数据来自服务端 MCP 工具（`graph_list` / `graph_get` / `registry_discover`），它们已随包实现（`asset-mcp-server.js` 共 12 个工具，不止 read）。

## 3. 迁移到新服务器

在新服务器上重复第 1 步即可（新机器 → 新 `NEO4J_PASSWORD`/端口/域名）。此后：
- **Graph 侧只需把「中心地址」改成新地址**（见 `community/GRAPH-PROJECT-CONFIG-ADAPTATION.md`），
  通过环境变量 / 项目本地配置 / 用户默认地址分层生效。
- 成员副本会按注册自动重建；已有成员可在中心执行 `mirror_sync`（或等定时任务）补齐。

## 4. 拆分部署（引擎单独一台，有出网）

Store 与引擎可分开：

```
# Store 机器（可无出网，只需私网能到引擎）
INSTALL_ENGINE=false
MIRROR_ENGINE_URL=http://<引擎内网IP>:18801
```

引擎机器按第 1 步的正常安装（`INSTALL_ENGINE=true`）。Store 通过 `MIRROR_ENGINE_URL` 私网访问引擎。

## 5. 运行时单元与排障

| 单元 | 位置 | 说明 |
|---|---|---|
| `asset-mcp.service` | 本机 | Graph Store（`/mcp`、`/graph/read`）|
| `graph-store-web.service` | 本机 | 社区网站（静态，`/archgraph/`）|
| `argo-mirror-engine.service` | 引擎机 | ARGO 镜像引擎（Neo4j + ARGO + embedding）|
| `sync-mirrors.timer` | Store 机 | 每 30 分钟幂等重同步所有成员副本 |
| docker `argo-neo4j` | 引擎机 | Neo4j（一成员一 database）|

```bash
systemctl status asset-mcp argo-mirror-engine sync-mirrors.timer
journalctl -u argo-mirror-engine -n 50 --no-pager
docker logs --tail 50 argo-neo4j
```

## 6. 关键配置项（`deploy/graph-store.env`）

见 `deploy/graph-store.env.example`。要点：`GRAPH_STORE_HOST/PORT`、`INSTALL_ENGINE`、`MIRROR_HOST/PORT`、
`MIRROR_ENGINE_URL`、`NEO4J_*`、`ARGO_EMBEDDING_*`/`QWEN_KEY`、`ARGO_NPM_PACKAGE`、`GITHUB_TOKEN`、
`INSTALL_WEB`、`WEB_HOST/PORT/BASE`。
（对外反代/域名/TLS 属 IT 职责，无对应配置项。）

## 7. 安全

- `~/.argo/.env` 与 `~/.git-credentials` 均 `600`；勿入库。
- demo 阶段 `requester` 为自称（弱鉴权），勿对外承诺强安全。
- Token 建议定期轮换。
