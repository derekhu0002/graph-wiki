#!/usr/bin/env bash
# =============================================================================
# 总知识图谱服务 - 远程服务器部署脚本
#
# 在远程 Linux 服务器 (Ubuntu 22.04 + Docker + Nginx) 上部署：
#   1. Neo4j 投影与语义存储（Docker 容器，内网端口 7687/7474）
#   2. ARGO 工具链 (~/.argo) 同步
#   3. 总知识图谱仓库 (graph-wiki) 同步
#   4. 环境配置 (~/.argo/.env: Neo4j 连接 + embedding key)
#   5. systemd 服务 argo-mcp-gateway
#   6. Nginx 反向代理（kg-mcp site）
#
# 用法:
#   bash server/deploy-remote.sh root@120.24.114.13 [NEO4J_PASSWORD] [EMBEDDING_KEY]
#   # 或通过环境变量传入，避免明文落盘历史：
#   NEO4J_PASSWORD=xxx EMBEDDING_KEY=xxx bash server/deploy-remote.sh root@120.24.114.13
#
# 前置: 本机已配置免密 SSH；若在本机(WSL)运行需先复制 ~/.ssh 密钥到 WSL。
# =============================================================================
set -euo pipefail

# ---------- 配置 ----------
SSH_HOST="${1:-root@120.24.114.13}"
REMOTE_DIR="/opt/graph-wiki"
LOCAL_ARGO_DIR="${ARGO_DIR:-$HOME/.argo}"
KG_MCP_PORT="18792"
DOMAIN="${KG_DOMAIN:-argo.derekworkspacev5.com}"

NEO4J_PASSWORD="${NEO4J_PASSWORD:-${2:-}}"
EMBEDDING_KEY="${EMBEDDING_KEY:-${3:-}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$NEO4J_PASSWORD" ]; then
  echo "!! 缺少 Neo4j 密码。用法: bash server/deploy-remote.sh root@HOST [NEO4J_PASSWORD]" >&2
  exit 1
fi

echo "==> 部署目标: $SSH_HOST:$REMOTE_DIR"
echo "==> 本地仓库: $REPO_ROOT"

# ---------- 1. 同步 ARGO 工具链到服务器 ----------
echo "==> [1/6] 同步 ARGO 工具链到服务器 ~/.argo ..."
if [ ! -f "$LOCAL_ARGO_DIR/scripts/argo-mcp-server.js" ]; then
  echo "!! 未找到本机 ARGO 工具链: $LOCAL_ARGO_DIR" >&2
  exit 1
fi
ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p ~/.argo"
rsync -az --delete \
  --exclude 'node_modules' \
  "$LOCAL_ARGO_DIR/" "$SSH_HOST:~/.argo/"
echo "    工具链同步完成"

# ---------- 2. 同步总知识图谱仓库 ----------
echo "==> [2/6] 同步总知识图谱仓库到 $REMOTE_DIR ..."
ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p $REMOTE_DIR"
if ssh -o BatchMode=yes "$SSH_HOST" "test -d $REMOTE_DIR/.git"; then
  ssh -o BatchMode=yes "$SSH_HOST" "cd $REMOTE_DIR && git pull --ff-only" || echo "    (git pull 失败，改用 rsync)"
fi
rsync -az --delete \
  --exclude '.git' \
  --exclude '.argo' \
  --exclude 'node_modules' \
  --exclude 'server/neo4j/data' \
  "$REPO_ROOT/" "$SSH_HOST:$REMOTE_DIR/"
echo "    仓库同步完成"

# ---------- 3. 部署 Neo4j 容器 ----------
echo "==> [3/6] 部署 Neo4j 容器 (kg-neo4j) ..."
ssh -o BatchMode=yes "$SSH_HOST" "cd $REMOTE_DIR/server/neo4j && \
  NEO4J_USER=neo4j NEO4J_PASSWORD='$NEO4J_PASSWORD' docker compose up -d 2>&1 | tail -5"
sleep 8
ssh -o BatchMode=yes "$SSH_HOST" "docker ps --filter name=kg-neo4j --format '{{.Names}} {{.Status}} {{.Ports}}'"

# ---------- 4. 安装服务器 Node 依赖 + 配置环境 ----------
echo "==> [4/6] 安装 ARGO 依赖并写入环境配置 ..."
ssh -o BatchMode=yes "$SSH_HOST" "cd ~/.argo && npm install --production 2>&1 | tail -3"
if [ -n "$EMBEDDING_KEY" ]; then
  ssh -o BatchMode=yes "$SSH_HOST" "cat > ~/.argo/.env <<EOF
ARGO_EMBEDDING_BASE_URL=https://llm-clids9mqc5o1mbvb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
ARGO_EMBEDDING_MODEL=qwen3.7-text-embedding
ARGO_EMBEDDING_PROVIDER=alibaba-cloud-model-studio-openai-compatible-cn-beijing
ARGO_EMBEDDING_MODEL_VERSION=qualification-2026-07-25
ARGO_EMBEDDING_DIMENSIONS=1536
ARGO_NEO4J_DATABASE_URL=neo4j://127.0.0.1:7687
ARGO_NEO4J_DATABASE_USERNAME=neo4j
ARGO_NEO4J_DATABASE_PASSWORD=$NEO4J_PASSWORD
QWEN_KEY=$EMBEDDING_KEY
ARGO_LIVE_PROVIDER_E2E=1
ARGO_W31_LIVE_MUTATION_VECTOR_E2E=1
EOF
chmod 600 ~/.argo/.env
echo '    环境配置已写入 ~/.argo/.env'"
else
  echo "    !! 未提供 EMBEDDING_KEY，请手动配置 ~/.argo/.env 的 embedding 参数"
fi

# ---------- 5. 配置 systemd 服务 ----------
echo "==> [5/6] 配置 systemd 服务 argo-mcp-gateway ..."
ssh -o BatchMode=yes "$SSH_HOST" "cat > /etc/systemd/system/argo-mcp-gateway.service <<'EOF'
[Unit]
Description=ARGO MCP HTTP/SSE Gateway (总知识图谱远端服务)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$REMOTE_DIR
Environment=ARGO_REPO_ROOT=$REMOTE_DIR
Environment=KG_MCP_PORT=$KG_MCP_PORT
Environment=KG_MCP_HOST=127.0.0.1
Environment=ARGO_ENV_FILE=/root/.argo/.env
ExecStart=/usr/bin/node $REMOTE_DIR/server/argo-mcp-http-gateway.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable argo-mcp-gateway
systemctl restart argo-mcp-gateway
sleep 2
systemctl status argo-mcp-gateway --no-pager | head -10
"

# ---------- 6. 配置 Nginx 反向代理 ----------
echo "==> [6/6] 配置 Nginx 反向代理 ..."
ssh -o BatchMode=yes "$SSH_HOST" "cat > /etc/nginx/sites-available/kg-mcp <<'EOF'
server {
    listen 80;
    server_name $DOMAIN;

    location /mcp {
        proxy_pass http://127.0.0.1:$KG_MCP_PORT/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_set_header Connection '';
    }

    location /health {
        proxy_pass http://127.0.0.1:$KG_MCP_PORT/health;
        proxy_set_header Host \$host;
    }

    location / {
        proxy_pass http://127.0.0.1:$KG_MCP_PORT/;
        proxy_set_header Host \$host;
    }
}
EOF
ln -sf /etc/nginx/sites-available/kg-mcp /etc/nginx/sites-enabled/kg-mcp
nginx -t && systemctl reload nginx
"

echo ""
echo "==> 部署完成！"
echo "    网关服务: http://127.0.0.1:$KG_MCP_PORT (systemd: argo-mcp-gateway)"
echo "    Neo4j:    neo4j://127.0.0.1:7687 (容器 kg-neo4j)"
echo "    健康检查: curl http://127.0.0.1:$KG_MCP_PORT/health"
echo "    MCP 端点: http://$DOMAIN/mcp"
