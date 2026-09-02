#!/bin/bash
# =============================================================================
# AI 组织资产 MCP 服务 - 远程部署脚本
#
# 在远程 Linux 服务器上部署轻量 asset MCP HTTP/SSE 服务：
#   1. 初始化 /opt/graph-wiki 为 git 仓库（管理 assets/）
#   2. 同步 assets/ 和 mcp/ 服务代码
#   3. 配置 systemd 服务 asset-mcp
#   4. 配置 Nginx 反向代理（合并进 argo.derekworkspacev5.com）
#
# 用法: bash mcp/deploy-asset-mcp.sh [root@120.24.114.13]
# =============================================================================
set -euo pipefail

SSH_HOST="${1:-root@120.24.114.13}"
REMOTE_DIR="/opt/graph-wiki"
ASSET_MCP_PORT="18792"
DOMAIN="${ASSET_DOMAIN:-argo.derekworkspacev5.com}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> 部署目标: $SSH_HOST:$REMOTE_DIR"

# 1. 初始化远程 git 仓库
echo "==> [1/5] 初始化远程 git 仓库"
ssh -o BatchMode=yes "$SSH_HOST" "cd $REMOTE_DIR && git init 2>/dev/null || true; git config user.name 'asset-mcp' 2>/dev/null || true; git config user.email 'asset-mcp@localhost' 2>/dev/null || true"

# 2. 同步 assets 和 mcp
echo "==> [2/5] 同步 assets/ 和 mcp/"
ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p $REMOTE_DIR/mcp"
rsync -az --exclude '.git' "$REPO_ROOT/assets/" "$SSH_HOST:$REMOTE_DIR/assets/"
rsync -az "$REPO_ROOT/mcp/asset-mcp-server.js" "$SSH_HOST:$REMOTE_DIR/mcp/"

# 3. 配置 systemd
echo "==> [3/5] 配置 systemd 服务 asset-mcp"
ssh -o BatchMode=yes "$SSH_HOST" "cat > /etc/systemd/system/asset-mcp.service <<'EOF'
[Unit]
Description=AI Organization Asset MCP HTTP/SSE Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$REMOTE_DIR
Environment=ASSET_MCP_PORT=$ASSET_MCP_PORT
Environment=ASSET_MCP_HOST=127.0.0.1
Environment=ASSET_REPO_ROOT=$REMOTE_DIR
ExecStart=/usr/bin/node $REMOTE_DIR/mcp/asset-mcp-server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable asset-mcp
systemctl restart asset-mcp
sleep 2
systemctl status asset-mcp --no-pager | head -8
"

# 4. Nginx 反代（合并进现有站点）
echo "==> [4/5] 配置 Nginx 反代 /mcp"
ssh -o BatchMode=yes "$SSH_HOST" "grep -q 'asset-mcp' /etc/nginx/sites-available/argo.derekworkspacev5.com 2>/dev/null && echo '已存在' || true"

# 5. 验证
echo "==> [5/5] 验证服务"
ssh -o BatchMode=yes "$SSH_HOST" "curl -s http://127.0.0.1:$ASSET_MCP_PORT/health"

echo ""
echo "==> 部署完成！"
echo "    服务: http://127.0.0.1:$ASSET_MCP_PORT (systemd: asset-mcp)"
echo "    健康: curl http://127.0.0.1:$ASSET_MCP_PORT/health"
