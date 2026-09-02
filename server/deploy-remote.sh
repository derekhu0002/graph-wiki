#!/usr/bin/env bash
# =============================================================================
# 总知识图谱服务 - 远程服务器部署脚本
#
# 在远程 Linux 服务器 (Ubuntu 22.04) 上部署总知识图谱 ARGO MCP HTTP/SSE 网关：
#   1. 同步 ARGO 工具链 (~/.argo) 到服务器
#   2. 同步总知识图谱仓库 (graph-wiki) 到服务器
#   3. 安装 Node 依赖
#   4. 配置系统服务 (systemd) + Nginx 反向代理
#
# 用法:
#   bash server/deploy-remote.sh [--ssh-host root@120.24.114.13]
#
# 前置: 本机已配置到服务器的免密 SSH，服务器已安装 Node 22 / Nginx / Git。
# =============================================================================
set -euo pipefail

# ---------- 配置 ----------
SSH_HOST="${1:-root@120.24.114.13}"
REMOTE_DIR="/opt/graph-wiki"          # 服务器上总图谱仓库位置
LOCAL_ARGO_DIR="$HOME/.argo"          # 本机 ARGO 工具链（服务器端放到 ~/.argo）
SERVER_USER="root"
KG_MCP_PORT="18789"
DOMAIN="${KG_DOMAIN:-argo.derekworkspacev5.com}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> 部署目标: $SSH_HOST:$REMOTE_DIR"
echo "==> 本地仓库: $REPO_ROOT"

# ---------- 1. 校验本机 ARGO 工具链 ----------
if [ ! -f "$LOCAL_ARGO_DIR/scripts/argo-mcp-server.js" ]; then
  echo "!! 未找到本机 ARGO 工具链: $LOCAL_ARGO_DIR" >&2
  exit 1
fi

# ---------- 2. 同步 ARGO 工具链到服务器 ----------
echo "==> [1/5] 同步 ARGO 工具链到服务器 ~/.argo ..."
ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p ~/.argo"
rsync -az --delete \
  --exclude 'node_modules' \
  "$LOCAL_ARGO_DIR/" "$SSH_HOST:~/.argo/"
echo "    工具链同步完成"

# ---------- 3. 同步总知识图谱仓库 ----------
echo "==> [2/5] 同步总知识图谱仓库到 $REMOTE_DIR ..."
ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p $REMOTE_DIR"
# 优先 git pull，未初始化则 rsync
if ssh -o BatchMode=yes "$SSH_HOST" "test -d $REMOTE_DIR/.git"; then
  ssh -o BatchMode=yes "$SSH_HOST" "cd $REMOTE_DIR && git pull --ff-only" || echo "    (git pull 失败，改用 rsync)"
fi
rsync -az --delete \
  --exclude '.git' \
  --exclude '.argo' \
  --exclude 'node_modules' \
  "$REPO_ROOT/" "$SSH_HOST:$REMOTE_DIR/"
echo "    仓库同步完成"

# ---------- 4. 安装服务器 Node 依赖 ----------
echo "==> [3/5] 安装服务器 ARGO 依赖 ..."
ssh -o BatchMode=yes "$SSH_HOST" "cd ~/.argo && npm install --production 2>&1 | tail -3"

# ---------- 5. 配置 systemd 服务 ----------
echo "==> [4/5] 配置 systemd 服务 argo-mcp-gateway ..."
ssh -o BatchMode=yes "$SSH_HOST" "cat > /etc/systemd/system/argo-mcp-gateway.service <<'EOF'
[Unit]
Description=ARGO MCP HTTP/SSE Gateway (总知识图谱远端服务)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$REMOTE_DIR
Environment=ARGO_REPO_ROOT=$REMOTE_DIR
Environment=KG_MCP_PORT=$KG_MCP_PORT
Environment=KG_MCP_HOST=127.0.0.1
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
echo "==> [5/5] 配置 Nginx 反向代理 ..."
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
echo "    健康检查: curl http://127.0.0.1:$KG_MCP_PORT/health"
echo "    MCP 端点: https://$DOMAIN/mcp"
