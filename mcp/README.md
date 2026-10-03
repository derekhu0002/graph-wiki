# 图谱资产 MCP 服务

轻量的远程 MCP HTTP/SSE 服务，供本机各 AI AGENT 查询、获取、提交**图谱资产**。
参考 teamai-cli 的思路：Git 仓库管理 + MCP 服务分发，但资产统一为整张
ARCHGRAPH 图谱（不是独立单文件）。

## 服务端点

| 端点 | 说明 |
|---|---|
| `https://argo.derekworkspacev5.com/mcp` | MCP 端点（公网，HTTPS） |
| `http://127.0.0.1:18792/mcp` | 内网端点（服务器本机） |
| `https://argo.derekworkspacev5.com/graph/read` | 跨项目图查询 REST 端点（POST JSON，供 ARGO MCP 直接调用） |
| `https://argo.derekworkspacev5.com/health` | 健康检查 |

## 工具

| 工具 | 说明 |
|---|---|
| `graph_list` | 列出图谱资产 |
| `graph_get` | 获取一张图谱资产（元数据 + 完整 ARCHGRAPH 图谱） |
| `graph_submit` | 提交新图谱资产（内部自动 schema 校验，不通过则拒收不入库） |
| `graph_update` | 更新图谱资产（内部自动 schema 校验，不通过则拒收不入库） |
| `registry_register` | 联邦成员自注册到中心（身份/职责/能力/开放内容清单） |
| `registry_deregister` | 联邦成员自注销，注销后 discover 不再可见 |
| `registry_discover` | 发现已注册成员的基础信息（它是谁、做什么、有什么能力） |
| `registry_authorize` | 成员显式授权某请求方读取其开放内容 |
| `registry_read` | 授权后读取成员开放内容（引用，非副本）；未授权默认拒绝 |
| `graph_read_external` | 跨项目图谱查询（不复用 registry_read）：授权后按 `projectId` 读中心托管副本并返回查询结果+版本 |
| `mirror_sync` | 按成员已审核分支同步其仓到中心副本（投影+向量化），按 git 版本幂等 |
| `mirror_list` | 列出中心已托管的成员副本 |

> 所有写入接口内部自动执行 ARCHGRAPH schema 校验（结构完整性、ArchiMate 类型
> 合法性、id 唯一、关系端点引用存在、view 成员存在、顶层视图唯一）。
> 校验不通过则返回错误并停止入库。变更入口唯一化，不支持外部直接写文件。

## 联邦注册中心（Registry，P0 只读）

ArchGraph「联邦式意图图谱（Federated Intent Graph = Registry–Broker Federation over sovereign
knowledge graphs）」的中心：每个项目是自治「国家」，各自维护意图图；
组织是「联邦」。中心保存**成员元数据**与**授权**：`registry_read` 仍按引用读取
（`ref` 指向成员自身图谱/仓库位置，不传内容副本）；此外中心可作为**副本托管方**，
托管成员经 push/merge 审核后开放的图谱**可用性副本**，供跨项目图查询
（见下「跨项目图谱查询」）。成员仓始终是事实源，中心不改写成员仓。

- 元数据文件：`assets/registry/registry.json`（`members[]` + `grants[]`）
- 逻辑模块：`mcp/registry.js`（纯 Node 零依赖，被服务与验收测试共同复用）
- 数据语义：`openContent[]` 的每项是 `{ id, name, ref }`，`ref` 是引用而非副本
- id 所有权：中心确认 `id` 全局唯一；同一 id 被不同来源仓注册时拒绝（防抢占）

| 工具 | 语义 |
|---|---|
| `registry_register` | 自注册（含 id/name/role/capabilities/openContent/sourceRepo） |
| `registry_deregister` | 自注销（同时撤销其授予与被授的授权） |
| `registry_discover` | 读已注册成员基础信息（无鉴权，元数据公开） |
| `registry_authorize` | grantor 授权 grantee（contentId 缺省 `*` 全部开放内容） |
| `registry_read` | requester 读 member 开放内容：命中授权返回引用清单，否则 `{status:"denied"}`（默认拒绝） |

## 跨项目图谱查询（副本托管）

在「引用读取」之外，中心另开一条**独立**接口，用于按项目 ID 查询中心托管的成员图谱副本；
**不复用 `registry_read`**。

- 托管：`mirror_sync { projectId }` 按成员已审核分支同步其仓 → 投影 + 向量化到命名空间
  `proj:<projectId>`（`assets/mirrors/<projectId>/`）；以 git commit 为版本，版本未变幂等跳过。
- 读取：`graph_read_external { requester, projectId, op, id?, type?, text?, limit?, depth? }`
  或 REST `POST /graph/read`（同一业务入口）。`op`：`overview|elements|element|neighbors|views|search`。
- 授权：读前校验 `grants(grantor=projectId, grantee=requester)`；未授权默认拒绝
  （`denied/not_authorized`），成员不存在/已注销 `denied/member_not_found`，副本未托管 `denied/mirror_not_synced`。
- 隔离：每张副本独立命名空间，任何查询只落在单一 `projectId`，禁止跨图 join。
- 说明：向量化当前为纯 Node 本地哈希向量（`vectors.json`），可替换为真实 embedding，形状不变。

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

服务为纯 Node 实现（零外部依赖，仅用内置模块），部署非常轻量。

### 仓库

源码托管在 GitHub：`https://github.com/derekhu0002/graph-wiki.git`

> 运行服务实际只需要仓库中的 `mcp/` 与 `assets/` 两个部分，其余目录（design/tests/.argo 等）
> 与 MCP 服务无关。

### 方式一：Git clone 最小运行

```bash
# 1. Clone（只拉最新历史）
git clone --depth 1 https://github.com/derekhu0002/graph-wiki.git graph-mcp
cd graph-mcp

# 2. 配置 git 身份（服务自动提交资产时必需）
git config user.name "graph-mcp"
git config user.email "graph-mcp@localhost"

# 3. 前台启动测试
ASSET_REPO_ROOT=$(pwd) ASSET_MCP_PORT=18792 node mcp/asset-mcp-server.js
# 看到 "listening on http://127.0.0.1:18792" 即成功

# 4. 健康检查
curl http://127.0.0.1:18792/health   # → {"status":"ok","service":"graph-mcp"}
```

### 方式二：生产部署（systemd）

```bash
# 1. Clone 到 /opt/graph-mcp
sudo mkdir -p /opt/graph-mcp
sudo git clone --depth 1 https://github.com/derekhu0002/graph-wiki.git /opt/graph-mcp
cd /opt/graph-mcp
sudo git config user.name "graph-mcp"
sudo git config user.email "graph-mcp@localhost"

# 2. 创建 systemd 服务
sudo tee /etc/systemd/system/graph-mcp.service > /dev/null <<'EOF'
[Unit]
Description=Graph Asset MCP HTTP/SSE Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/graph-mcp
Environment=ASSET_REPO_ROOT=/opt/graph-mcp
Environment=ASSET_MCP_PORT=18792
Environment=ASSET_MCP_HOST=127.0.0.1
ExecStart=/usr/bin/node /opt/graph-mcp/mcp/asset-mcp-server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 3. 启动并设置开机自启
sudo systemctl daemon-reload
sudo systemctl enable --now graph-mcp
sudo systemctl status graph-mcp
```

### 方式三：公网暴露（可选，Nginx 反代）

若要让其他设备/Agent 通过域名访问，用 Nginx 反代（含 SSE 支持）：

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:18792/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Connection '';
}
```

### 多设备同步

每台设备上的服务做 `graph_submit/graph_update` 时自动**本地 git commit**，
但不会 `git push`。以 GitHub 主仓为唯一事实源，多设备通过 pull/push 对齐，避免分叉：

```bash
cd /opt/graph-mcp
git pull   # 拉取其他设备/本机已推送的新提交
git push   # 推送本设备的资产提交回 GitHub
```

> 注意：git commit 的源分支是各设备独立的本地 commit，多设备部署建议以 GitHub
> 为主仓，各设备 pull/push 对齐，避免分叉。

### 联邦注册中心同步（registry.json）

`registry_register / registry_deregister / registry_authorize` 写入
`assets/registry/registry.json` 并在服务器本地 git 自动 commit，但**不 push**（服务器
无 GitHub 凭据）。用 `mcp/registry-sync.sh` 在「持有 GitHub push 凭据」的机器上对齐：

```bash
bash mcp/registry-sync.sh push   # 服务器 -> GitHub（回补/持续同步，幂等，无变化自动跳过）
bash mcp/registry-sync.sh pull   # GitHub -> 服务器（多设备 pull 对齐）
```

- **持续同步**：在凭据机 crontab 加定时任务（幂等）：
  `*/5 * * * * cd /path/to/graph-wiki && bash mcp/registry-sync.sh push >> /var/log/registry-sync.log 2>&1`
- **触发式 push（可选升级）**：给服务器配置 GitHub 只写 deploy key，再把
  `asset-mcp-server.js` 的 `gitCommit` 追加一步 `git push origin main`，注册/授权/注销
  即写完即推；脚本仍作为无凭据场景的兜底。
- 环境变量可覆盖 `SSH_HOST`（默认 `root@120.24.114.13`）、`REMOTE_DIR`（默认
  `/opt/graph-wiki`）、`REPO_DIR`（默认脚本所在仓库根）。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `ASSET_MCP_PORT` | 监听端口 | 18792 |
| `ASSET_MCP_HOST` | 监听地址 | 127.0.0.1 |
| `ASSET_REPO_ROOT` | 仓库根（含 assets/ 和 .git） | 自动检测 |
| `ASSET_ROOT` | 资产根目录 | `<repo>/assets` |
| `ASSET_GIT_DIR` | git 提交目录 | `<repo>` |
