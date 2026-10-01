#!/usr/bin/env bash
# =============================================================================
# Graph Store + ARGO Mirror Engine — one-command installer (Linux server)
#
# Usage:
#   git clone <repo> && cd <repo>
#   cp deploy/graph-store.env.example deploy/graph-store.env
#   vi deploy/graph-store.env           # 填 Neo4j 密码、QWEN_KEY、域名等
#   sudo bash deploy/install-graph-store.sh
#
# 幂等：重复执行会重装/重启服务。默认在本机同时部署
#   - Graph Store（asset MCP，127.0.0.1:$GRAPH_STORE_PORT）
#   - ARGO 镜像引擎（ARGO + Neo4j + embedding，127.0.0.1:$MIRROR_PORT）
# 若 INSTALL_ENGINE=false，则只部署 Store 并把 MIRROR_ENGINE_URL 指向外部引擎。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/deploy/graph-store.env"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

: "${GRAPH_STORE_HOST:=127.0.0.1}"
: "${GRAPH_STORE_PORT:=18792}"
: "${INSTALL_ENGINE:=true}"
: "${MIRROR_HOST:=127.0.0.1}"
: "${MIRROR_PORT:=18801}"
: "${MIRROR_ENGINE_URL:=http://${MIRROR_HOST}:${MIRROR_PORT}}"
: "${NEO4J_IMAGE:=neo4j:5.26-enterprise}"
: "${NEO4J_USER:=neo4j}"
: "${NEO4J_PASSWORD:=}"
: "${NEO4J_HEAP:=1g}"
: "${NEO4J_PAGECACHE:=512m}"
: "${ARGO_NPM_PACKAGE:=archgraph-argo}"
: "${NPM_REGISTRY:=https://registry.npmmirror.com}"
: "${NODE_VERSION:=v22.11.0}"
: "${ENABLE_NGINX:=false}"
: "${DOMAIN:=}"
: "${ASSET_ROOT:=$REPO_ROOT/assets}"

ARGO_ROOT="${HOME}/.argo"
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"

log() { echo -e "\n==> $*"; }

# ---------------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "[1] 安装 Node.js $NODE_VERSION ($NPM_REGISTRY)"
  tmp="$(mktemp -d)"
  url="${NPM_REGISTRY}/-/binary/node/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/node.tar.xz" "$url"
  tar -xf "$tmp/node.tar.xz" -C /usr/local --strip-components=1
  rm -rf "$tmp"
  NODE_BIN=/usr/local/bin/node
fi
log "[1] node: $($NODE_BIN --version)"

# ---------------------------------------------------------------------------
# 2. ARGO engine + Neo4j + embedding (仅 INSTALL_ENGINE=true)
# ---------------------------------------------------------------------------
if [ "$INSTALL_ENGINE" = "true" ]; then
  log "[2] 安装 ARGO 引擎 ($ARGO_NPM_PACKAGE)"
  npm i -g "$ARGO_NPM_PACKAGE" --registry="$NPM_REGISTRY" >/dev/null
  PKG_DIR="$(npm root -g)/$ARGO_NPM_PACKAGE"
  mkdir -p "$ARGO_ROOT"
  cp -r "$PKG_DIR/argo/scripts" "$PKG_DIR/argo/schema" "$PKG_DIR/argo/defaults" "$ARGO_ROOT/" 2>/dev/null || true
  [ -d "$PKG_DIR/argo/mcp-bridges" ] && cp -r "$PKG_DIR/argo/mcp-bridges" "$ARGO_ROOT/"
  cp "$PKG_DIR/argo/package.json" "$ARGO_ROOT/"
  ( cd "$ARGO_ROOT" && npm install --registry="$NPM_REGISTRY" >/dev/null )

  if [ -z "$NEO4J_PASSWORD" ]; then echo "ERROR: 请在 $ENV_FILE 设置 NEO4J_PASSWORD"; exit 1; fi
  if [ -z "${QWEN_KEY:-}" ]; then echo "ERROR: 请在 $ENV_FILE 设置 QWEN_KEY"; exit 1; fi

  log "[2] 写 $ARGO_ROOT/.env (600)"
  cat > "$ARGO_ROOT/.env" <<EOF
ARGO_EMBEDDING_BASE_URL=${ARGO_EMBEDDING_BASE_URL:-}
ARGO_EMBEDDING_MODEL=${ARGO_EMBEDDING_MODEL:-qwen3.7-text-embedding}
ARGO_EMBEDDING_PROVIDER=alibaba-cloud-model-studio-openai-compatible-cn-beijing
ARGO_EMBEDDING_DIMENSIONS=${ARGO_EMBEDDING_DIMENSIONS:-1536}
ARGO_NEO4J_DATABASE_URL=neo4j://127.0.0.1:7687
ARGO_NEO4J_DATABASE_USERNAME=${NEO4J_USER}
ARGO_NEO4J_DATABASE_PASSWORD=${NEO4J_PASSWORD}
QWEN_KEY=${QWEN_KEY}
ARGO_LIVE_PROVIDER_E2E=1
EOF
  chmod 600 "$ARGO_ROOT/.env"

  log "[2] 启动 Neo4j ($NEO4J_IMAGE) —— 需支持多 database"
  mkdir -p /opt/argo-neo4j/data /opt/argo-neo4j/logs
  docker rm -f argo-neo4j >/dev/null 2>&1 || true
  docker run -d --name argo-neo4j --restart unless-stopped \
    -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 \
    -e NEO4J_ACCEPT_LICENSE_AGREEMENT=yes \
    -e NEO4J_AUTH="${NEO4J_USER}/${NEO4J_PASSWORD}" \
    -e NEO4J_server_memory_heap_max__size="${NEO4J_HEAP}" \
    -e NEO4J_server_memory_pagecache_size="${NEO4J_PAGECACHE}" \
    -v /opt/argo-neo4j/data:/data -v /opt/argo-neo4j/logs:/logs \
    "$NEO4J_IMAGE" >/dev/null

  if [ -n "${GITHUB_TOKEN:-}" ]; then
    log "[2] 配置私有仓 Git 凭据"
    printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" > "$HOME/.git-credentials"
    chmod 600 "$HOME/.git-credentials"
    git config --global credential.helper store || true
  fi
fi

# ---------------------------------------------------------------------------
# 3. systemd units（模板替换）
# ---------------------------------------------------------------------------
log "[3] 安装 systemd 单元"
install_unit() {
  sed -e "s#__REPO__#${REPO_ROOT}#g" \
      -e "s#__HOME__#${HOME}#g" \
      -e "s#__NODE__#${NODE_BIN}#g" \
      -e "s#__GRAPH_STORE_HOST__#${GRAPH_STORE_HOST}#g" \
      -e "s#__GRAPH_STORE_PORT__#${GRAPH_STORE_PORT}#g" \
      -e "s#__MIRROR_ENGINE_URL__#${MIRROR_ENGINE_URL}#g" \
      -e "s#__MIRROR_HOST__#${MIRROR_HOST}#g" \
      -e "s#__MIRROR_PORT__#${MIRROR_PORT}#g" \
      "$1" > "/etc/systemd/system/$(basename "$1")"
}
install_unit "$REPO_ROOT/deploy/systemd/asset-mcp.service"
install_unit "$REPO_ROOT/deploy/systemd/sync-mirrors.service"
install_unit "$REPO_ROOT/deploy/systemd/sync-mirrors.timer"
[ "$INSTALL_ENGINE" = "true" ] && install_unit "$REPO_ROOT/deploy/systemd/argo-mirror-engine.service"
systemctl daemon-reload

log "[3] 启动服务"
if [ "$INSTALL_ENGINE" = "true" ]; then systemctl enable --now argo-mirror-engine; fi
systemctl enable --now asset-mcp
systemctl enable --now sync-mirrors.timer

# ---------------------------------------------------------------------------
# 4. Nginx（可选）
# ---------------------------------------------------------------------------
if [ "$ENABLE_NGINX" = "true" ] && [ -n "$DOMAIN" ]; then
  log "[4] 配置 Nginx 反代 $DOMAIN"
  sed -e "s#__DOMAIN__#${DOMAIN}#g" \
      -e "s#__GRAPH_STORE_PORT__#${GRAPH_STORE_PORT}#g" \
      "$REPO_ROOT/deploy/nginx-graph-store.conf.template" > "/etc/nginx/conf.d/graph-store-${DOMAIN}.conf"
  nginx -t && systemctl reload nginx
fi

# ---------------------------------------------------------------------------
# 5. 健康检查
# ---------------------------------------------------------------------------
log "[5] 健康检查"
sleep 2
echo -n "asset-mcp  : "; curl -s --max-time 5 "http://${GRAPH_STORE_HOST}:${GRAPH_STORE_PORT}/health" || echo "(未就绪)"
echo
if [ "$INSTALL_ENGINE" = "true" ]; then
  echo -n "mirror-eng : "; curl -s --max-time 5 "http://${MIRROR_HOST}:${MIRROR_PORT}/health" || echo "(未就绪)"
  echo
fi
cat <<EOF

==> 完成。
    本地访问:   http://${GRAPH_STORE_HOST}:${GRAPH_STORE_PORT}/mcp  (MCP)
                http://${GRAPH_STORE_HOST}:${GRAPH_STORE_PORT}/graph/read  (REST)
    MCP 客户端:  {"mcp":{"graph-mcp":{"type":"remote","url":"http://127.0.0.1:${GRAPH_STORE_PORT}/mcp","enabled":true}}}
    外部访问:   设置 ENABLE_NGINX=true 与 DOMAIN=你的域名，再重跑本脚本。
EOF
